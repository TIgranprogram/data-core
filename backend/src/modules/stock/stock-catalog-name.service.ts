import { Injectable, type OnModuleInit } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import type { ClientSession, Connection, Model } from 'mongoose';
import { normalizeCatalogName, StockCatalogName, type StockCatalogNameDocument } from './stock-catalog-name.schema';

class ReservationInsertConflict extends Error {
  constructor(readonly original: unknown) { super('Конкурентная первая резервация имени'); }
}

@Injectable()
export class StockCatalogNameService implements OnModuleInit {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(StockCatalogName.name) private readonly names: Model<StockCatalogNameDocument>,
  ) {}

  async onModuleInit(): Promise<void> {
    // Mongo 4.4: коллекция должна существовать до первой транзакции, включая production autoIndex:false.
    await this.names.createCollection();
  }

  async acquire(names: string[], session: ClientSession): Promise<void> {
    const keys = [...new Set(names.map(normalizeCatalogName).filter(Boolean))].sort();
    for (const key of keys) {
      try {
        // Всегда запись: один $setOnInsert не сериализует уже существующий ключ.
        await this.names.findOneAndUpdate({ _id: key }, { $inc: { revision: 1 } }, { upsert: true, session }).exec();
      } catch (error) {
        // Перехватывается только ошибка этой записи; E11000 materials/sku не превращаем в retry.
        const e = error as { code?: number; keyPattern?: Record<string, number>; keyValue?: Record<string, unknown> };
        if (e.code === 11000 && e.keyPattern?._id === 1 && e.keyValue?._id === key) throw new ReservationInsertConflict(error);
        throw error;
      }
    }
  }

  async run<T>(names: string[], work: (session: ClientSession) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const session = await this.connection.startSession();
      try {
        // Драйвер повторяет callback на TransientTransactionError и commit на UnknownTransactionCommitResult.
        return await session.withTransaction(async () => {
          await this.acquire(names, session);
          return work(session);
        }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } }) as T;
      } catch (error) {
        if (!(error instanceof ReservationInsertConflict)) throw error;
        if (attempt >= 4) throw error.original;
        // Первая параллельная вставка _id: новая session и новый snapshot, без таймера.
      } finally {
        await session.endSession();
      }
    }
  }
}
