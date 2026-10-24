import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import { SEED_WRITE_OFF_REASONS, WRITE_OFF_DICT } from '../../modules/stock/stock-target';

/**
 * Справочник «Причины списания» (SK-5): брак, потеря, порча, прочее. Заполняется один раз — только если в справочнике
 * нет ни одной строки (даже удалённой): что убрали или поправили в «Справочниках», обратно не возвращается.
 */
@Injectable()
export class WriteOffReasonsSeed implements OnApplicationBootstrap {
  private readonly logger = new Logger(WriteOffReasonsSeed.name);

  constructor(@InjectConnection() private readonly connection: Connection) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      const coll = this.connection.db!.collection('dict_values');
      if (await coll.countDocuments({ dict: WRITE_OFF_DICT }, { limit: 1 })) return;
      const now = new Date();
      await coll.insertMany(SEED_WRITE_OFF_REASONS.map((name) => ({ dict: WRITE_OFF_DICT, name, deletedAt: null, createdAt: now, updatedAt: now })));
      this.logger.log(`Причины списания: добавлено ${SEED_WRITE_OFF_REASONS.length}`);
    } catch (err) {
      this.logger.warn(`Не удалось заполнить причины списания: ${(err as Error).message}`);
    }
  }
}
