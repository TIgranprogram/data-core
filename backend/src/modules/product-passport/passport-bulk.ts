import { claimPassportOwners, withOrderWrite } from '../../common/order-archive/write';
import { BadRequestException, ConflictException, HttpException } from '@nestjs/common';
import { Types, type ClientSession, type Connection, type Model } from 'mongoose';
import type { ProductPassportDocument } from './product-passport.schema';
import { AFTER_PRINT_FIELDS, BULK_NUMBER_FIELDS, BULK_PASSPORT_FIELDS, OID_FIELDS, isIssued, type Doc } from './passport-consts';

/** Что массовым действиям нужно от сервиса паспортов (одиночные операции — те же, что в карточке). */
export interface BulkHost {
  model: Model<ProductPassportDocument>;
  connection: Connection;
  findById: (id: string, session: ClientSession) => Promise<ProductPassportDocument>;
  update: (id: string, patch: never, session: ClientSession) => Promise<unknown>;
  snapshot: (id: string, session: ClientSession) => Promise<unknown>;
  oid: (v: unknown) => Types.ObjectId;
}

/** Массовые изменения паспортов (БЗ-9) и «Отменить»; вызывается из ProductPassportService. */
export class PassportBulk {
  constructor(private readonly h: BulkHost) {}

  /**
   * Массовое изменение выбранных паспортов (БЗ-9): только общие поля (белый список), номера / талоны / названия — нет.
   * arrays: elements / materialIds — 'add' (добавить к своим) или 'replace'. Смена категории — текст паспорта пересобирается
   * по новой категории (rebuildText, по умолчанию да). Возвращает before — прежние значения для «Отменить» (bulkRestore).
   */
  async run(dto: { ids?: unknown; set?: Record<string, unknown>; arrays?: Record<string, string>; rebuildText?: boolean }) {
    const ids = Array.isArray(dto.ids) ? [...new Set(dto.ids.map(String))] : [];
    if (!ids.length) throw new BadRequestException('Отметьте паспорта');
    if (ids.length > 500) throw new BadRequestException('За один раз — не больше 500 паспортов');
    const set = Object.fromEntries(Object.entries(dto.set ?? {}).filter(([k]) => (BULK_PASSPORT_FIELDS as readonly string[]).includes(k)));
    if (!Object.keys(set).length) throw new BadRequestException('Отметьте, что изменить');
    if (set.passportCategory === 'MAF') set.passportCategory = 'BLG'; // старый код (2026-10-25)
    if (set.passportCategory !== undefined && set.passportCategory !== '' && !['DIO', 'DSP', 'TRN', 'WRK', 'BLG'].includes(String(set.passportCategory))) throw new BadRequestException('Неизвестный тип паспорта');
    for (const k of BULK_NUMBER_FIELDS) if (k in set && set[k] !== null && set[k] !== '') { const n = Number(String(set[k]).replace(',', '.')); if (!Number.isFinite(n) || n < 0) throw new BadRequestException('Числа — не меньше нуля'); set[k] = n; }
    for (const k of ['elements', 'materialIds'] as const) if (k in set && !Array.isArray(set[k])) throw new BadRequestException('Элементы и материалы — список');
    const rebuild = dto.rebuildText !== false && 'passportCategory' in set;
    return withOrderWrite(this.h.connection, [], async session => {
      await this.claimOwners(ids, session);
      const before: Array<{ id: string; set: Record<string, unknown> }> = [];
      const failed: Array<{ id: string; message: string }> = [];
      let updated = 0;
      for (const id of ids) {
        try {
          const doc = (await this.h.findById(id, session)).toObject() as unknown as Doc;
          const patch: Record<string, unknown> = { ...set };
          // НМ: выпущенный паспорт массово меняется только в полях «после печати»; аннулированный — никак
          if (doc.status === 'annulled') throw new ConflictException(`№ ${doc.passportNumber}: аннулирован`);
          const lockedKeys = Object.keys(patch).filter((k) => !(AFTER_PRINT_FIELDS as readonly string[]).includes(k));
          if (isIssued(doc) && lockedKeys.length) throw new ConflictException(`№ ${doc.passportNumber}: выпущен — массово меняются только поля «после печати»`);
          for (const k of ['elements', 'materialIds'] as const) {
            if (k in patch && dto.arrays?.[k] === 'add') patch[k] = [...new Set([...((doc[k] as unknown[]) ?? []).map(String), ...(patch[k] as unknown[]).map(String)])];
          }
          const prev: Record<string, unknown> = Object.fromEntries(Object.keys(patch).map((k) => [k, doc[k] ?? null]));
          if (rebuild) prev.textSnapshot = doc.textSnapshot ?? null;
          await this.h.update(id, patch as never, session);
          if (rebuild) await this.h.snapshot(id, session);
          before.push({ id, set: prev });
          updated++;
        } catch (e) {
          if (!(e instanceof HttpException) || (e.getResponse() as { code?: string }).code === 'ORDER_ARCHIVED') throw e;
          failed.push({ id, message: e.message });
        }
      }
      return { updated, failed, before };
    });
  }

  private async claimOwners(ids: string[], session: ClientSession) {
    const docs = await this.h.connection.db!.collection('productpassports').find(
      { _id: { $in: ids.filter(Types.ObjectId.isValid).map(id => this.h.oid(id)) } },
      { session, projection: { incomeId: 1, salesOrderId: 1 } },
    ).toArray();
    await claimPassportOwners(this.h.connection.db!, session, docs.map(d => ({ salesOrderId: d.salesOrderId, incomeId: d.incomeId })));
  }

  /** «Отменить» массовое изменение (БЗ-9): вернуть прежние значения полей (в т. ч. текст паспорта) как были. */
  async restore(dto: { items?: Array<{ id?: string; set?: Record<string, unknown> }> }) {
    const items = Array.isArray(dto.items) ? dto.items : [];
    if (items.length > 500) throw new BadRequestException('За раз — не больше 500 паспортов'); // как у bulk (проверка архитектора 2026-10-23)
    return withOrderWrite(this.h.connection, [], async session => {
      await this.claimOwners(items.flatMap(it => it?.id ? [it.id] : []), session);
      let restored = 0;
      for (const it of items) {
        if (!it?.id || !Types.ObjectId.isValid(it.id)) continue;
        const raw = Object.fromEntries(Object.entries(it.set ?? {}).filter(([k]) => (BULK_PASSPORT_FIELDS as readonly string[]).includes(k) || k === 'textSnapshot'));
        const $set: Record<string, unknown> = {}; const $unset: Record<string, ''> = {};
        for (const [k, v] of Object.entries(raw)) {
          if (v === null || v === undefined) { $unset[k] = ''; continue; }
          if ((OID_FIELDS as readonly string[]).includes(k)) $set[k] = this.h.oid(v);
          else if (k === 'elements' || k === 'materialIds') $set[k] = (v as unknown[]).map((x) => this.h.oid(x));
          else if (k === 'saleDate' || k === 'installedAt') $set[k] = new Date(String(v));
          else $set[k] = v;
        }
        // аннулированный не возвращаем — его не меняют (как в update и bulk)
        const r = await this.h.model.updateOne({ _id: this.h.oid(it.id), status: { $ne: 'annulled' } }, { ...(Object.keys($set).length ? { $set } : {}), ...(Object.keys($unset).length ? { $unset } : {}) }, { session }).exec();
        restored += r.modifiedCount;
      }
      return { restored };
    });
  }
}
