import { Injectable, Logger } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection, ClientSession } from 'mongoose';

interface CounterDocShape {
  seq: number;
}

@Injectable()
export class CounterService {
  private readonly logger = new Logger(CounterService.name);

  constructor(@InjectConnection() private readonly connection: Connection) {}

  /**
   * Atomically increment the sequence for (entity, prefix, year) and return
   * a formatted number like "KP-2026-001".
   *
   * Uses a Mongo session + transaction (Replica Set required) to guarantee
   * no duplicates under concurrent calls.
   */
  async next(
    entity: string,
    prefix: string,
    year: number = new Date().getFullYear(),
  ): Promise<string> {
    const session: ClientSession = await this.connection.startSession();

    try {
      let seq = 0;

      await session.withTransaction(async () => {
        const result = await this.connection
          .collection<CounterDocShape>('counters')
          .findOneAndUpdate(
            { entity, prefix, year },
            { $inc: { seq: 1 } },
            {
              upsert: true,
              returnDocument: 'after',
              session,
            },
          );

        // With upsert + returnDocument:'after', result is always present
        // (either the upserted doc or the updated one).
        seq = result?.seq ?? 1;
      });

      const formatted = `${prefix}-${year}-${String(seq).padStart(3, '0')}`;
      this.logger.debug(`Counter ${entity}/${prefix}/${year} → ${formatted}`);
      return formatted;
    } catch (err) {
      this.logger.error(
        `Counter next() failed for ${entity}/${prefix}/${year}: ${(err as Error).message}`,
      );
      throw err;
    } finally {
      await session.endSession();
    }
  }

  /**
   * Сквозной номер без года и форматирования: атомарный `$inc` по (entity, prefix), год в ключе всегда 0.
   * Параллельные вызовы получают разные числа; при гонке первого upsert (E11000) — один повтор.
   */
  async nextSeq(entity: string, prefix: string): Promise<number> {
    const col = this.connection.collection<CounterDocShape>('counters');
    const run = async () => {
      const r = await col.findOneAndUpdate({ entity, prefix, year: 0 }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: 'after' });
      return r?.seq ?? 1;
    };
    try {
      return await run();
    } catch (err) {
      if ((err as { code?: number }).code !== 11000) throw err;
      return run();
    }
  }

  /** Засев: счётчик не меньше n (после уже занятых номеров). Меньшее значение счётчик не опускает. */
  async setSeqAtLeast(entity: string, prefix: string, n: number): Promise<void> {
    const col = this.connection.collection<CounterDocShape>('counters');
    const run = () => col.updateOne({ entity, prefix, year: 0 }, { $max: { seq: n } }, { upsert: true });
    try {
      await run();
    } catch (err) {
      if ((err as { code?: number }).code !== 11000) throw err;
      await run();
    }
  }
}
