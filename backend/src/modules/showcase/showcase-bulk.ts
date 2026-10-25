import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { oid } from '../../common/list-query';
import { mergePassportDefaults, normalizePassportDefaults, presentPassportDefaults, type PassportDefaults } from './passport-defaults';
import { variants, type Db, type Doc } from './showcase-common';

/** То, что массовым действиям нужно от витрины (одиночные операции — те же, что и в карточке). */
export interface BulkHost {
  db: () => Db;
  present: (docs: Doc[]) => Promise<Array<{ type: string | null; group: string | null }>>;
  update: (id: string, patch: Record<string, unknown>) => Promise<unknown>;
  setPassportDefaults: (id: string, v: Record<string, unknown>) => Promise<unknown>;
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
    const before: Array<{ id: string; set: Record<string, unknown> }> = [];
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
        const prev: Record<string, unknown> = {};
        for (const k of ['categoryId', 'series', 'status', 'listPrice', 'designerId', 'unit', 'ralCode', 'colors', 'sizes', 'passportDefaults']) prev[k] = raw[k] ?? null;
        if (Object.keys(patch).length) await this.h.update(id, patch);
        if (set.passportDefaults && typeof set.passportDefaults === 'object') {
          const merged = mergePassportDefaults(presentPassportDefaults(raw.passportDefaults as PassportDefaults), set.passportDefaults as Record<string, unknown>);
          await this.h.setPassportDefaults(id, merged);
        }
        before.push({ id, set: prev });
        updated++;
      } catch (e) { failed.push({ id, message: e instanceof Error ? e.message : String(e) }); }
    }
    return { updated, failed, before };
  }

  /** «Отменить» массовое изменение изделий (БЗ-9): прежние значения полей — как были. */
  async restore(dto: { items?: Array<{ id?: string; set?: Record<string, unknown> }> }) {
    if (Array.isArray(dto.items) && dto.items.length > 500) throw new BadRequestException('За раз — не больше 500 изделий');
    let restored = 0;
    for (const it of Array.isArray(dto.items) ? dto.items : []) {
      if (!it?.id || !Types.ObjectId.isValid(it.id)) continue;
      const $set: Record<string, unknown> = { updatedAt: new Date() }; const $unset: Record<string, ''> = {};
      for (const [k, v] of Object.entries(it.set ?? {})) {
        if (!['categoryId', 'series', 'status', 'listPrice', 'designerId', 'unit', 'ralCode', 'colors', 'sizes', 'passportDefaults'].includes(k)) continue;
        if (v === null || v === undefined) { if (k === 'categoryId' || k === 'designerId' || k === 'passportDefaults' || k === 'series' || k === 'ralCode') $unset[k] = ''; continue; }
        if (k === 'categoryId' || k === 'designerId') $set[k] = new Types.ObjectId(String(v));
        else if (k === 'passportDefaults') $set[k] = normalizePassportDefaults(v as Record<string, unknown>);
        else $set[k] = v;
      }
      const r = await this.db.collection('products').updateOne({ _id: new Types.ObjectId(it.id) }, { $set, ...(Object.keys($unset).length ? { $unset } : {}) });
      restored += r.modifiedCount;
    }
    return { restored };
  }
}
