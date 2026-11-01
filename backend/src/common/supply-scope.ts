import { ForbiddenException } from '@nestjs/common';
import type { Connection } from 'mongoose';
import { Types } from 'mongoose';
import { inScope, scopeMatch, type StockScope } from './stock-scope';

/**
 * Склады (WZ) для документов, ссылающихся на позицию склада или категорию: заявки (`supplyrequests`), каталог поставщиков (`supplieritems`).
 * Документ виден, если его позиция (`materialId`) в доступе; без позиции — по его категории (`categoryId`); без обоих — «Основному».
 */
const both = (ids: Iterable<string>) => [...ids].filter((x) => Types.ObjectId.isValid(x)).flatMap((x) => [new Types.ObjectId(x), x]);

/** Условие для запроса к документам с `materialId` / `categoryId`; `{}` — доступ полный. Объединять через `$and`. */
export async function docScopeMatch(connection: Connection, scope: StockScope | null | undefined): Promise<Record<string, unknown>> {
  if (!scope) return {};
  const mats = await connection.db!.collection('materials').find(scopeMatch(scope), { projection: { _id: 1 } }).toArray();
  const or: Record<string, unknown>[] = [{ materialId: { $in: mats.map((m) => m._id) } }];
  if (scope.categoryIds.length) or.push({ materialId: null, categoryId: { $in: both(scope.categoryIds) } });
  if (scope.noCategory) or.push({ materialId: null, categoryId: null });
  return { $or: or };
}

/** Документ в доступе? Позицию читает из базы только при `materialId`. */
export async function docInScope(connection: Connection, scope: StockScope | null | undefined, rawDoc: object): Promise<boolean> {
  if (!scope) return true;
  const doc = rawDoc as { materialId?: unknown; categoryId?: unknown };
  if (doc.materialId) {
    const m = await connection.db!.collection('materials').findOne({ _id: new Types.ObjectId(String(doc.materialId)) }, { projection: { categoryId: 1 } });
    return !!m && inScope(scope, m);
  }
  return doc.categoryId ? scope.categoryIds.includes(String(doc.categoryId)) : scope.noCategory;
}

export async function assertDocInScope(connection: Connection, scope: StockScope | null | undefined, doc: object, text = 'Эта заявка не из вашего склада'): Promise<void> {
  if (!(await docInScope(connection, scope, doc))) throw new ForbiddenException(text);
}

/** Новая запись или смена позиции/категории: должна остаться в своём складе. Ничего не указано — только «Основному». */
export async function assertNewDocInScope(
  connection: Connection, scope: StockScope | null | undefined,
  dto: { materialId?: string | null; categoryId?: string | null; categoryName?: string | null },
  text = 'Эта позиция или категория не из вашего склада',
): Promise<void> {
  if (!scope) return;
  if (dto.materialId) return assertDocInScope(connection, scope, { materialId: dto.materialId }, text);
  if (dto.categoryId) return assertDocInScope(connection, scope, { categoryId: dto.categoryId }, text);
  const name = String(dto.categoryName ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (name) {
    const own = await connection.db!.collection('categories').find({ _id: { $in: scope.categoryIds.filter((x) => Types.ObjectId.isValid(x)).map((x) => new Types.ObjectId(x)) } }, { projection: { name: 1 } }).toArray();
    if (own.some((c) => String(c.name).trim().toLowerCase().replace(/\s+/g, ' ') === name)) return;
    throw new ForbiddenException(text);
  }
  if (!scope.noCategory) throw new ForbiddenException(text);
}
