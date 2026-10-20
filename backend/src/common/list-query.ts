import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';

/**
 * Общий разбор параметров списка (CANON §4): page, limit, sort, search, период, корзина.
 * Сортировка — только по разрешённым полям: `sort=-requestDate` (минус — по убыванию).
 */
export interface ListParams {
  page: number;
  limit: number;
  skip: number;
  sort: Record<string, 1 | -1>;
  search?: RegExp;
  /** true — показать только удалённые (корзина). */
  deleted: boolean;
}

export const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function parseList(
  q: Record<string, unknown>,
  opts: { sortable: string[]; defaultSort: string; maxLimit?: number; defaultLimit?: number },
): ListParams {
  const page = Math.max(1, Math.floor(Number(q.page) || 1));
  const limit = Math.min(opts.maxLimit ?? 1000, Math.max(1, Math.floor(Number(q.limit) || opts.defaultLimit || 25)));
  const raw = String(q.sort || opts.defaultSort);
  const field = raw.replace(/^-/, '');
  if (!opts.sortable.includes(field)) throw new BadRequestException(`Нельзя сортировать по «${field}»`);
  const s = String(q.search ?? '').trim();
  return {
    page, limit, skip: (page - 1) * limit,
    sort: { [field]: raw.startsWith('-') ? -1 : 1 },
    search: s ? new RegExp(escapeRe(s), 'i') : undefined,
    deleted: q.deleted === '1' || q.deleted === 'true' || q.deleted === true,
  };
}

/** Фильтр по периоду поля даты: from/to — `YYYY-MM-DD` включительно. */
export function dateRange(from?: unknown, to?: unknown): Record<string, Date> | undefined {
  const r: Record<string, Date> = {};
  const d = (v: unknown, end: boolean) => {
    const m = String(v ?? '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) { if (v) throw new BadRequestException('Дата — в формате ГГГГ-ММ-ДД'); return undefined; }
    return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + (end ? 1 : 0)));
  };
  const f = d(from, false), t = d(to, true);
  if (f) r.$gte = f;
  if (t) r.$lt = t;
  return Object.keys(r).length ? r : undefined;
}

/** ObjectId из строки или 400 с понятным текстом. */
export function oid(id: unknown, what = 'записи'): Types.ObjectId {
  if (!Types.ObjectId.isValid(String(id))) throw new BadRequestException(`Некорректный id ${what}`);
  return new Types.ObjectId(String(id));
}

/** Список id через запятую → ObjectId[] (мусор отбрасывается). */
export function oids(v: unknown): Types.ObjectId[] {
  return String(v ?? '').split(',').map((s) => s.trim()).filter((s) => Types.ObjectId.isValid(s)).map((s) => new Types.ObjectId(s));
}
