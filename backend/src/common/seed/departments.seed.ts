import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';

/** Справочник «Отделы» (кому выдаём со склада; дальше — связь с видами работ и производством). */
export const DEPARTMENTS_DICT = 'departments';
export const SEED_DEPARTMENTS = ['Сварочный отдел', 'Деревянный отдел', 'Малярный отдел'];

/**
 * Заполняется один раз — только если в справочнике нет ни одной строки (даже удалённой):
 * что убрали или поправили в «Справочниках», обратно не возвращается.
 */
@Injectable()
export class DepartmentsSeed implements OnApplicationBootstrap {
  private readonly logger = new Logger(DepartmentsSeed.name);

  constructor(@InjectConnection() private readonly connection: Connection) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      const coll = this.connection.db!.collection('dict_values');
      if (await coll.countDocuments({ dict: DEPARTMENTS_DICT }, { limit: 1 })) return;
      const now = new Date();
      await coll.insertMany(SEED_DEPARTMENTS.map((name) => ({ dict: DEPARTMENTS_DICT, name, deletedAt: null, createdAt: now, updatedAt: now })));
      this.logger.log(`Отделы: добавлено ${SEED_DEPARTMENTS.length}`);
    } catch (err) {
      this.logger.warn(`Не удалось заполнить отделы: ${(err as Error).message}`);
    }
  }
}
