/**
 * Тонкое чтение shared-коллекций. Доменных правил нет: живой фильтр — `raw-query`,
 * поля — контракт `fields.ts`. Запись сюда не входит.
 */
import { rawCount, rawFind, type RawFilter, type RawQueryOpts, type RawReadCollection } from '../raw-query';
import { SHARED_READ_FIELDS, type SharedCollection } from './fields';

const NAMES = new Set<string>(Object.keys(SHARED_READ_FIELDS));

export interface SharedReadCursor {
  limit(n: number): SharedReadCursor;
  sort(spec: object): SharedReadCursor;
  toArray(): Promise<Array<{ _id: unknown } & Record<string, unknown>>>;
}

export function isSharedCollection(name: string): name is SharedCollection {
  return NAMES.has(name);
}

function assertName(name: string): asserts name is SharedCollection {
  if (!isSharedCollection(name)) throw new Error(`shared-collections: неизвестная коллекция ${name}`);
}

/** Проекция из контракта. `_id` разрешён всегда. Чужое поле — ошибка программиста, документ не читаем. */
export function sharedProjection(name: SharedCollection, fields: readonly string[]): Record<string, 1> {
  const allowed = new Set(SHARED_READ_FIELDS[name]);
  const out: Record<string, 1> = {};
  for (const field of fields) {
    if (field === '_id') {
      out._id = 1;
      continue;
    }
    if (!allowed.has(field)) throw new Error(`shared-collections: поле ${name}.${field} не в контракте чтения`);
    out[field] = 1;
  }
  return out;
}

function checkedProjection(name: SharedCollection, projection: Record<string, unknown>): Record<string, unknown> {
  for (const [field, flag] of Object.entries(projection)) {
    if (field === '_id') {
      if (flag !== 0 && flag !== 1 && flag !== true && flag !== false) {
        throw new Error(`shared-collections: проекция ${name}._id только 0 или 1`);
      }
      continue;
    }
    if (flag !== 1 && flag !== true) throw new Error(`shared-collections: проекция ${name}.${field} только включение`);
    if (!SHARED_READ_FIELDS[name].includes(field)) throw new Error(`shared-collections: поле ${name}.${field} не в контракте чтения`);
  }
  return projection;
}

export interface SharedFindOpts extends RawQueryOpts {
  /** Нет проекции — документ целиком (как прямой find). Есть — только поля контракта. */
  projection?: Record<string, unknown>;
  findOptions?: object;
}

/** Курсор драйвера. `deletedAt: null`, если вызывающий не передал свой `deletedAt` и не `includeDeleted`. */
export function sharedFind(col: RawReadCollection, name: SharedCollection, filter?: RawFilter, opts?: SharedFindOpts): SharedReadCursor {
  assertName(name);
  const projection = opts?.projection ? checkedProjection(name, opts.projection) : undefined;
  const findOptions = { ...(opts?.findOptions ?? {}), ...(projection ? { projection } : {}) };
  return rawFind(col, filter, findOptions, { includeDeleted: opts?.includeDeleted }) as SharedReadCursor;
}

export function sharedCount(col: RawReadCollection, name: SharedCollection, filter?: RawFilter, opts?: RawQueryOpts & { countOptions?: object }): unknown {
  assertName(name);
  return rawCount(col, filter, opts?.countOptions, { includeDeleted: opts?.includeDeleted });
}
