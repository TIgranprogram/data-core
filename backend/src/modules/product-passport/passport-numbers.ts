import { ConflictException } from '@nestjs/common';
import type { ClientSession, Connection } from 'mongoose';
import { dayUtc, warrantyCodeFor } from './passport-rules';

/** Что номерам нужно от сервиса паспортов. */
export interface NumbersHost {
  connection: Connection;
  /** Максимум числового поля среди паспортов (с удалёнными). */
  maxOf: (field: 'passportNumber' | 'productCode', session?: ClientSession) => Promise<number>;
}

type Field = 'passportNumber' | 'productCode';

/** ПН: номера паспортов — показать следующие и задать, какой № получит следующий выпущенный паспорт. */
export class PassportNumbers {
  constructor(private readonly h: NumbersHost) {}

  private async counter(key: Field): Promise<number> {
    return Number((await this.h.connection.collection('counters').findOne({ entity: 'passport', prefix: key, year: 0 }))?.seq) || 0;
  }

  private async last(field: Field) {
    return Math.max(await this.counter(field), await this.h.maxOf(field));
  }

  /** Только показ, ничего не занимает: max(счётчик, максимум в паспортах) + 1. */
  async nextNumbers(date: Date = dayUtc()) {
    const p = await this.last('passportNumber');
    const c = await this.last('productCode');
    return { lastPassportNo: p, nextPassportNo: p + 1, nextWarrantyCode: warrantyCodeFor(date, p + 1), lastProductCode: c, nextProductCode: c + 1 };
  }

  /**
   * Задать следующие номера: № паспорта (`next`) и/или № изделия (`nextProductCode`) — счётчик = значение − 1.
   * Не меньше, чем максимум существующих + 1. Талон не задаётся — он из даты и № паспорта.
   */
  async setNext(want: { next?: number; nextProductCode?: number }) {
    const pairs: Array<[Field, number, string]> = [];
    if (want.next != null) pairs.push(['passportNumber', want.next, '№ паспорта']);
    if (want.nextProductCode != null) pairs.push(['productCode', want.nextProductCode, '№ изделия']);
    for (const [field, n, label] of pairs) {
      const max = await this.h.maxOf(field);
      if (n <= max) throw new ConflictException(`${label} ${n} уже занят — следующий может быть не меньше ${max + 1}`);
    }
    for (const [field, n] of pairs) {
      await this.h.connection.collection('counters').updateOne({ entity: 'passport', prefix: field, year: 0 }, { $set: { seq: n - 1 } }, { upsert: true });
    }
    return this.nextNumbers();
  }
}
