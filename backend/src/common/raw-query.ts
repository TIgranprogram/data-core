/**
 * Сырое чтение коллекции (драйвер Mongo, без плагина soft-delete).
 * По умолчанию оставляет только живые документы (`deletedAt: null`).
 * Доменных правил здесь нет: хозяин коллекции решает, можно ли звать хелпер.
 */

export interface RawQueryOpts {
  /** true — не добавлять `deletedAt: null`. */
  includeDeleted?: boolean;
}

export type RawFilter = Record<string, unknown>;

/** Минимальный контракт коллекции драйвера: find / countDocuments / aggregate. */
export interface RawReadCollection {
  find(filter: RawFilter, options?: object): unknown;
  countDocuments(filter: RawFilter, options?: object): unknown;
  aggregate(pipeline: RawFilter[], options?: object): unknown;
}

const MUST_FIRST = new Set(['$geoNear', '$search', '$searchMeta', '$vectorSearch', '$changeStream']);

/** Фильтр живых документов. Явный `deletedAt` в фильтре не перетирается. Вход не меняется. */
export function liveFilter<T extends RawFilter>(filter?: T, opts?: RawQueryOpts): T {
  const src = (filter ?? {}) as T;
  if (opts?.includeDeleted) return src;
  if (src.deletedAt !== undefined) return src;
  return { ...src, deletedAt: null };
}

function stageName(stage: RawFilter): string | undefined {
  const keys = Object.keys(stage);
  return keys.length === 1 ? keys[0] : undefined;
}

/** Пайплайн с живым `$match`. `$geoNear` / `$search` остаются первой стадией. */
export function livePipeline(pipeline: RawFilter[], opts?: RawQueryOpts): RawFilter[] {
  if (opts?.includeDeleted) return pipeline;
  const first = pipeline[0];
  const name = first ? stageName(first) : undefined;
  if (name === '$match' && first.$match && typeof first.$match === 'object' && !Array.isArray(first.$match)) {
    const match = first.$match as RawFilter;
    if (match.deletedAt !== undefined) return pipeline;
    return [{ $match: { ...match, deletedAt: null } }, ...pipeline.slice(1)];
  }
  const live: RawFilter = { $match: { deletedAt: null } };
  if (name && MUST_FIRST.has(name)) return [first, live, ...pipeline.slice(1)];
  return [live, ...pipeline];
}

export function rawFind(col: RawReadCollection, filter?: RawFilter, findOptions?: object, opts?: RawQueryOpts): unknown {
  return col.find(liveFilter(filter, opts), findOptions);
}

export function rawCount(col: RawReadCollection, filter?: RawFilter, countOptions?: object, opts?: RawQueryOpts): unknown {
  return col.countDocuments(liveFilter(filter, opts), countOptions);
}

export function rawAggregate(col: RawReadCollection, pipeline: RawFilter[] = [], aggOptions?: object, opts?: RawQueryOpts): unknown {
  return col.aggregate(livePipeline(pipeline, opts), aggOptions);
}
