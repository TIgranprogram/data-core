import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { oid } from '../../common/list-query';
import { legacyDefaultsReplacement, mergePassportDefaults, normalizePassportDefaults, presentPassportDefaults, type PassportDefaults } from './passport-defaults';
import { variants, type Db, type Doc } from './showcase-common';
import { restoreBulkProduct } from '../../common/product-owner-port';
import { bulkExpected, bulkFingerprint } from './showcase-bulk-cas';

/** То, что массовым действиям нужно от витрины (одиночные операции — те же, что и в карточке). */
export interface BulkHost {
  db: () => Db;
  present: (docs: Doc[]) => Promise<Array<{ type: string | null; group: string | null }>>;
  applyRow: (raw: Doc, patch: Record<string, unknown>, defaults?: Record<string, unknown>, incomingDefaults?: Record<string, unknown>) => Promise<{ set: Record<string, unknown>; expected: string }>;
}

/** Массовые изменения изделий (БЗ-9) и «Отменить»; вызывается из ShowcaseService. */
export class ShowcaseBulk {
  constructor(private readonly h: BulkHost) {}
  private get db() { return this.h.db(); }

  /**
   * Массовое изменение выбранных изделий (БЗ-9): раздел / группа (меняется одно — второе у каждого своё), серия, статус, цена,
   * «Кто проектировал», ед. изм., RAL, цвета / размеры (arrays: add | replace), значения паспорта по умолчанию (дополняются).
   * Артикул, наименование, фото, состав — только по одному. before — прежние значения для «Отменить» (bulkRestore).
   */
  async run(dto: { ids?: unknown; set?: Record<string, unknown>; arrays?: Record<string, string> }) {
    const ids = Array.isArray(dto.ids) ? [...new Set(dto.ids.map(String))] : [];
    if (!ids.length) throw new BadRequestException('Отметьте изделия');
    if (ids.length > 500) throw new BadRequestException('За один раз — не больше 500 изделий');
    const FIELDS = ['type', 'group', 'series', 'status', 'price', 'designerId', 'unit', 'ralCode', 'colors', 'sizes', 'passportDefaults'];
    const set = Object.fromEntries(Object.entries(dto.set ?? {}).filter(([k]) => FIELDS.includes(k)));
    if (!Object.keys(set).length) throw new BadRequestException('Отметьте, что изменить');
    const before: Array<{ id: string; set: Record<string, unknown>; expected: string }> = [];
    const failed: Array<{ id: string; message: string }> = [];
    let updated = 0;
    for (const id of ids) {
      try {
        const raw = await this.db.collection('products').findOne({ _id: oid(id, 'изделия'), deletedAt: null });
        if (!raw) throw new NotFoundException('Изделие не найдено');
        const cur = (await this.h.present([raw as Doc]))[0];
        const patch: Record<string, unknown> = { ...set };
        delete patch.passportDefaults;
        if ('type' in set || 'group' in set) { patch.type = 'type' in set ? set.type : cur.type ?? ''; patch.group = 'group' in set ? set.group : cur.group ?? ''; }
        for (const k of ['colors', 'sizes'] as const) if (k in set && dto.arrays?.[k] === 'add') patch[k] = [...((raw[k] as string[]) ?? []), ...variants(set[k])];
        const merged = set.passportDefaults && typeof set.passportDefaults === 'object'
          ? mergePassportDefaults(presentPassportDefaults(raw.passportDefaults as PassportDefaults), set.passportDefaults as Record<string, unknown>) : undefined;
        const previous = await this.h.applyRow(raw as Doc, patch, merged, set.passportDefaults as Record<string, unknown> | undefined);
        before.push({ id, ...previous });
        updated++;
      } catch (e) { failed.push({ id, message: e instanceof Error ? e.message : String(e) }); }
    }
    return { updated, failed, before };
  }

  /** «Отменить» массовое изменение изделий (БЗ-9): прежние значения полей — как были. */
  async restore(dto: { items?: Array<{ id?: string; set?: Record<string, unknown>; expected?: string }> }) {
    if (Array.isArray(dto.items) && dto.items.length > 500) throw new BadRequestException('За раз — не больше 500 изделий');
    let restored = 0;
    const failed: Array<{ id: string; message: string }> = [];
    for (const it of Array.isArray(dto.items) ? dto.items : []) {
      if (!it?.id || !Types.ObjectId.isValid(it.id)) continue;
      try {
      const allowed = ['categoryId', 'series', 'status', 'listPrice', 'designerId', 'unit', 'ralCode', 'colors', 'sizes', 'passportDefaults'];
      const keys = Object.keys(it.set ?? {}).filter(key => allowed.includes(key));
      const current = await this.db.collection('products').findOne({ _id: new Types.ObjectId(it.id), deletedAt: null });
      if (!current) throw new NotFoundException('Изделие не найдено');
      if (it.expected !== undefined && it.expected !== bulkFingerprint(current, keys)) throw new ConflictException('После массовой правки изделие изменено — автоматическая отмена не выполнена');
      const $set: Record<string, unknown> = { updatedAt: new Date() }; const $unset: Record<string, ''> = {};
      const defaultReplacement = Object.prototype.hasOwnProperty.call(it.set ?? {}, 'passportDefaults')
        ? legacyDefaultsReplacement(normalizePassportDefaults((it.set?.passportDefaults ?? {}) as Record<string, unknown>)) : undefined;
      for (const [k, v] of Object.entries(it.set ?? {})) {
        if (!['categoryId', 'series', 'status', 'listPrice', 'designerId', 'unit', 'ralCode', 'colors', 'sizes'].includes(k)) continue;
        if (v === null || v === undefined) { if (k === 'categoryId' || k === 'designerId' || k === 'series' || k === 'ralCode') $unset[k] = ''; continue; }
        if (k === 'categoryId' || k === 'designerId') $set[k] = new Types.ObjectId(String(v));
        else $set[k] = v;
      }
      const patch = defaultReplacement ? [
        { $set: { ...Object.fromEntries(Object.entries($set).map(([k, v]) => [k, { $literal: v }])), passportDefaults: defaultReplacement } },
        ...(Object.keys($unset).length ? [{ $unset: Object.keys($unset) }] : []),
      ] : { $set, ...(Object.keys($unset).length ? { $unset } : {}) };
      const r = await restoreBulkProduct(this.db, new Types.ObjectId(it.id), bulkExpected(current, keys), patch);
      restored += r.modifiedCount;
      } catch (e) { failed.push({ id: it.id, message: e instanceof Error ? e.message : String(e) }); }
    }
    return { restored, failed };
  }
}
