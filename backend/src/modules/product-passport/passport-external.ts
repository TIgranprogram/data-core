import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Types, type ClientSession, type Connection, type Model } from 'mongoose';
import type { ProductPassportDocument } from './product-passport.schema';
import { dayUtc, warrantyCodeFor } from './passport-rules';
import type { Doc } from './passport-consts';

/** Что «внешним» номерам нужно от сервиса паспортов. */
export interface ExternalHost {
  model: Model<ProductPassportDocument>;
  connection: Connection;
  /** Максимум числового поля среди паспортов (с удалёнными). */
  maxOf: (field: 'passportNumber' | 'productCode', session?: ClientSession) => Promise<number>;
  /** Текущее значение счётчика (0 — нет). */
  counter: (key: 'passportNumber' | 'productCode') => Promise<number>;
  allocate: (set: Doc, date: Date, session?: ClientSession) => Promise<void>;
  assertFree: (set: Doc, selfId?: Types.ObjectId, session?: ClientSession) => Promise<void>;
}

export interface ExternalInput { productId: string; date?: string; customerName?: string; salesOrderId?: string; passportNumber?: string; productCode?: string }

/** ПН: номера для паспорта, который делают в другой программе — показать следующие и занять (выпущенный паспорт без проверки полноты). */
export class PassportExternal {
  constructor(private readonly h: ExternalHost) {}

  private async last(field: 'passportNumber' | 'productCode') {
    return Math.max(await this.h.counter(field), await this.h.maxOf(field));
  }

  /** Только показ, ничего не занимает: max(счётчик, максимум в паспортах) + 1. */
  async nextNumbers(date: Date = dayUtc()) {
    const p = await this.last('passportNumber');
    const c = await this.last('productCode');
    return { lastPassportNo: p, nextPassportNo: p + 1, nextWarrantyCode: warrantyCodeFor(date, p + 1), lastProductCode: c, nextProductCode: c + 1 };
  }

  /** Занять номера (атомарно, одной транзакцией) и создать выпущенный паспорт source 'external'. */
  async create(dto: ExternalInput) {
    if (!Types.ObjectId.isValid(dto.productId)) throw new BadRequestException('Укажите изделие');
    const productId = new Types.ObjectId(dto.productId);
    const product = await this.h.connection.collection('products').findOne({ _id: productId }, { projection: { name: 1, passportDefaults: 1 } });
    if (!product) throw new NotFoundException('Изделие не найдено');
    const date = dto.date ? new Date(dto.date) : dayUtc();
    if (Number.isNaN(date.getTime())) throw new BadRequestException('Неверная дата');
    const _id = new Types.ObjectId();
    const session = await this.h.connection.startSession();
    try {
      await session.withTransaction(async () => {
        const set: Doc = {};
        const no = String(dto.passportNumber ?? '').trim();
        if (no) { if (!/^\d{1,9}$/.test(no)) throw new BadRequestException('№ паспорта — от 1 до 9 цифр'); const n = Number(no); Object.assign(set, { passportNumber: String(n), passportNo: n }); }
        const code = String(dto.productCode ?? '').trim();
        if (code) set.productCode = /^\d{1,9}$/.test(code) ? String(Number(code)) : code;
        await this.h.assertFree(set, undefined, session); // переданное — занято → 409
        await this.h.allocate(set, date, session);
        await this.h.assertFree(set, undefined, session); // талон из даты и №
        await this.h.model.create([{
          ...set, _id, productId, date, name: product.name, warrantyMonths: product.passportDefaults?.warrantyMonths ?? 12,
          ...(dto.customerName ? { customerName: dto.customerName } : {}), ...(dto.salesOrderId && Types.ObjectId.isValid(dto.salesOrderId) ? { salesOrderId: new Types.ObjectId(dto.salesOrderId) } : {}),
          status: 'issued', issuedAt: new Date(), revision: 1, source: 'external', external: true,
        }], { session });
      });
    } catch (e) {
      if ((e as { code?: number }).code === 11000) throw new ConflictException('Номер уже занят, обновите и попробуйте ещё раз');
      throw e;
    } finally { await session.endSession(); }
    return this.h.model.findById(_id).exec();
  }
}
