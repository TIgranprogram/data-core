import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Types, type Connection } from 'mongoose';
import { oid } from '../../common/list-query';

/** База Mongo — то, что массовым действиям нужно от соединения (как в showcase-bulk.ts). */
type Db = NonNullable<Connection['db']>;

/** Поля, которые принимает массовая правка позиций (C043). Лишние ключи `set` игнорируются. */
const BULK_FIELDS = ['typeName', 'categoryId', 'categoryName', 'unit', 'materialGrade', 'assortment'] as const;

/** Поля, которые записывает «Отменить»: категория восстанавливается по id, названия в базе нет. */
const RESTORE_FIELDS = ['typeName', 'categoryId', 'unit', 'materialGrade', 'assortment'] as const;

/** То, что массовым действиям нужно от карточки позиции: запись, категория по названию, пометка «изменено в приложении». */
export interface BulkHost {
  db: () => Db;
  resolveCategory: (dto: { categoryId?: string; categoryName?: string }) => Promise<Types.ObjectId | undefined>;
  markEdited: (id: Types.ObjectId) => Promise<void>;
}

/**
 * C043: массовая правка отмеченных позиций «Остатков» — тип, категория, ед. изм., марка стали, сортамент —
 * и «Отменить» (вернуть прежние значения). Вызывается из StockCatalogService.
 * Категорию по названию создаёт/находит CategoryResolver (как PATCH /stock/items/:id); права и доступ по складам
 * проверяет контроллер до вызова (assertInScope, scopeNewItem).
 */
export class StockBulk {
  constructor(private readonly h: BulkHost) {}
  private get db() { return this.h.db(); }

  /**
   * Массовое изменение выбранных позиций: { ids ≤ 500, set } → { updated, failed, before }.
   * before — прежние значения (для «Отменить»); пустые строки типа / марки / сортамента пишутся как null.
   */
  async run(dto: { ids?: unknown; set?: Record<string, unknown> }) {
    const ids = Array.isArray(dto.ids) ? [...new Set(dto.ids.map(String))] : [];
    if (!ids.length) throw new BadRequestException('Отметьте позиции');
    if (ids.length > 500) throw new BadRequestException('За один раз — не больше 500 позиций');
    const set = Object.fromEntries(Object.entries(dto.set ?? {}).filter(([k]) => (BULK_FIELDS as readonly string[]).includes(k)));
    if (!Object.keys(set).length) throw new BadRequestException('Отметьте, что изменить');

    const patch: Record<string, unknown> = {};
    // текст: пустое значение стирает поле (тип после этого снова вычисляется из названия)
    for (const k of ['typeName', 'materialGrade', 'assortment'] as const) if (k in set) patch[k] = String(set[k] ?? '').trim() || null;
    // ед. изм. обязательна в общей с CRM схеме: пусто — не трогаем
    if ('unit' in set) { const unit = String(set.unit ?? '').trim(); if (unit) patch.unit = unit; }
    if ('categoryId' in set || 'categoryName' in set) {
      const categoryId = await this.h.resolveCategory({
        categoryId: set.categoryId == null ? undefined : String(set.categoryId),
        categoryName: set.categoryName == null ? undefined : String(set.categoryName),
      });
      if (categoryId) patch.categoryId = categoryId;
    }
    if (!Object.keys(patch).length) throw new BadRequestException('Отметьте, что изменить');

    const before: Array<{ id: string; set: Record<string, unknown> }> = [];
    const failed: Array<{ id: string; message: string }> = [];
    let updated = 0;
    for (const id of ids) {
      try {
        const _id = oid(id, 'позиции');
        const raw = await this.db.collection('materials').findOne({ _id, deletedAt: null }, { projection: { typeName: 1, categoryId: 1, unit: 1, materialGrade: 1, assortment: 1 } });
        if (!raw) throw new NotFoundException('Позиция не найдена');
        await this.db.collection('materials').updateOne({ _id, deletedAt: null }, { $set: { ...patch, updatedAt: new Date() } });
        await this.h.markEdited(_id); // как updateItem: синхронизация Google-таблиц позицию больше не перезаписывает
        before.push({ id, set: Object.fromEntries(RESTORE_FIELDS.map((k) => [k, (raw as Record<string, unknown>)[k] ?? null])) });
        updated++;
      } catch (e) { failed.push({ id, message: e instanceof Error ? e.message : String(e) }); }
    }
    return { updated, failed, before };
  }

  /** «Отменить» массовую правку: { items: [{ id, set }] } → { restored }; null возвращает прежнее пустое значение. */
  async restore(dto: { items?: Array<{ id?: string; set?: Record<string, unknown> }> }) {
    const items = Array.isArray(dto.items) ? dto.items : [];
    if (items.length > 500) throw new BadRequestException('За раз — не больше 500 позиций');
    let restored = 0;
    for (const it of items) {
      if (!it?.id || !Types.ObjectId.isValid(it.id)) continue;
      const _id = new Types.ObjectId(it.id);
      const $set: Record<string, unknown> = {}; const $unset: Record<string, ''> = {};
      for (const [k, v] of Object.entries(it.set ?? {})) {
        if (!(RESTORE_FIELDS as readonly string[]).includes(k)) continue;
        if (v === null || v === undefined) { $unset[k] = ''; continue; }
        if (k === 'categoryId' && !Types.ObjectId.isValid(String(v))) throw new BadRequestException('Неверная категория в откате');
        $set[k] = k === 'categoryId' ? new Types.ObjectId(String(v)) : String(v);
      }
      if (!Object.keys($set).length && !Object.keys($unset).length) continue;
      const r = await this.db.collection('materials').updateOne({ _id, deletedAt: null }, { $set: { ...$set, updatedAt: new Date() }, ...(Object.keys($unset).length ? { $unset } : {}) });
      if (r.modifiedCount) { restored += r.modifiedCount; await this.h.markEdited(_id); }
    }
    return { restored };
  }
}
