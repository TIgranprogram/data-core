import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import { Types } from 'mongoose';

/**
 * P1 — чистые функции валидации универсального хранилища данных приложений.
 * Всё, что приходит от клиента (имена, тело документа, filter, sort, page/limit),
 * проверяется здесь до обращения к Mongo. Ошибка → 400 (размер → 413).
 */

/**
 * Имя приложения: латиница/цифры, без `_` — иначе имя коллекции
 * `app_<app>_<collection>` неоднозначно (`a_b`+`c` и `a`+`b_c` → `app_a_b_c`).
 */
export const APP_NAME_RE = /^[a-z][a-z0-9]{0,39}$/;
/** Служебные коллекции сервера (`app_control_*`): через универсальное API недоступны. */
const RESERVED_APPS = new Set(['control']);
/** Имя коллекции внутри приложения. */
export const COLLECTION_NAME_RE = /^[a-z][a-z0-9_]{0,39}$/;

export const APP_COLLECTION_PREFIX = 'app_';
export const MAX_DOC_BYTES = 256 * 1024;
export const MAX_BULK = 500;
export const MAX_LIMIT = 200;
export const DEFAULT_LIMIT = 50;
const MAX_DEPTH = 32;

/** Поля, которые ставит только сервер; из тела клиента молча отбрасываются. */
export const SERVICE_FIELDS = ['_id', 'id', 'createdAt', 'updatedAt', 'createdBy', 'updatedBy', 'deletedAt'] as const;
const DATE_FIELDS = new Set(['createdAt', 'updatedAt', 'deletedAt']);

export const FILTER_OPERATORS = ['$eq', '$ne', '$gt', '$gte', '$lt', '$lte', '$in', '$nin', '$exists'] as const;
const FILTER_OPS = new Set<string>(FILTER_OPERATORS);

export function assertAppName(app: string): void {
  if (typeof app !== 'string' || !APP_NAME_RE.test(app) || RESERVED_APPS.has(app)) {
    throw new BadRequestException(
      `Некорректное имя приложения «${String(app)}»: нужно ^[a-z][a-z0-9]{0,39}$ (без подчёркивания)`,
    );
  }
}

export function assertCollectionName(collection: string): void {
  if (typeof collection !== 'string' || !COLLECTION_NAME_RE.test(collection)) {
    throw new BadRequestException(
      `Некорректное имя коллекции «${String(collection)}»: нужно ^[a-z][a-z0-9_]{0,39}$`,
    );
  }
}

/** `app` + `collection` → имя коллекции Mongo (с проверкой обоих имён). */
export function mongoCollectionName(app: string, collection: string): string {
  assertAppName(app);
  assertCollectionName(collection);
  return `${APP_COLLECTION_PREFIX}${app}_${collection}`;
}

/** Обратное преобразование: `app_<app>_<collection>` → части, или null для чужих имён. */
export function parseMongoCollectionName(name: string): { app: string; collection: string } | null {
  if (!name.startsWith(APP_COLLECTION_PREFIX)) return null;
  const rest = name.slice(APP_COLLECTION_PREFIX.length);
  const sep = rest.indexOf('_');
  if (sep <= 0 || RESERVED_APPS.has(rest.slice(0, sep))) return null;
  const app = rest.slice(0, sep);
  const collection = rest.slice(sep + 1);
  if (!APP_NAME_RE.test(app) || !COLLECTION_NAME_RE.test(collection)) return null;
  return { app, collection };
}

export function parseObjectId(id: string): Types.ObjectId {
  if (typeof id !== 'string' || !/^[0-9a-fA-F]{24}$/.test(id)) {
    throw new BadRequestException('Некорректный идентификатор (ожидается 24-символьный hex)');
  }
  return new Types.ObjectId(id);
}

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
}

/** Рекурсивно запрещает ключи с `$` (в начале или где угодно) и `.` на любой глубине. */
function assertSafeKeys(value: unknown, path: string, depth: number): void {
  if (depth > MAX_DEPTH) throw new BadRequestException(`Слишком глубокая вложенность (>${MAX_DEPTH})`);
  if (Array.isArray(value)) {
    value.forEach((el, i) => assertSafeKeys(el, `${path}[${i}]`, depth + 1));
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (k.includes('$') || k.includes('.') || k === '') {
        throw new BadRequestException(
          `Недопустимый ключ «${path ? path + '.' : ''}${k}»: ключи не могут быть пустыми и содержать «$» или «.»`,
        );
      }
      assertSafeKeys(v, path ? `${path}.${k}` : k, depth + 1);
    }
  }
}

/**
 * Тело одного документа: обычный JSON-объект, безопасные ключи, ≤256 КБ.
 * Служебные поля отбрасываются (клиент их не пишет). Возвращает очищенную копию.
 */
export function sanitizeDocument(body: unknown, label = 'Документ'): Record<string, unknown> {
  if (!isPlainObject(body)) {
    throw new BadRequestException(`${label} должен быть JSON-объектом`);
  }
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if ((SERVICE_FIELDS as readonly string[]).includes(k)) continue;
    clean[k] = v;
  }
  assertSafeKeys(clean, '', 0);
  assertDocumentSize(clean, label);
  return clean;
}

export function assertDocumentSize(doc: unknown, label = 'Документ'): void {
  const bytes = Buffer.byteLength(JSON.stringify(doc) ?? '', 'utf8');
  if (bytes > MAX_DOC_BYTES) {
    throw new PayloadTooLargeException(`${label} больше ${MAX_DOC_BYTES / 1024} КБ (${Math.ceil(bytes / 1024)} КБ)`);
  }
}

// ─── filter ─────────────────────────────────────────────────────────────

const FILTER_FIELD_RE = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)*$/;

/** Литерал без `$`-ключей (объекты/массивы допускаются как точное совпадение). */
function assertLiteral(value: unknown, path: string): void {
  if (value !== null && typeof value === 'object') {
    try {
      assertSafeKeys(value, path, 1);
    } catch {
      throw new BadRequestException(`filter: в значении «${path}» запрещены ключи с «$» или «.»`);
    }
  }
}

function normalizeFieldValue(field: string, value: unknown): unknown {
  if (field === '_id' && typeof value === 'string') return parseObjectId(value);
  if (DATE_FIELDS.has(field) && typeof value === 'string') {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) throw new BadRequestException(`filter: «${field}» — некорректная дата`);
    return d;
  }
  return value;
}

/**
 * `filter` из query — JSON-объект `{ field: value | { $op: value } }`.
 * Разрешены только операторы из FILTER_OPERATORS на уровне поля; любые другие
 * `$`-ключи (`$where`, `$expr`, `$function`, `$regex`, `$or`, …) → 400.
 * `id` → `_id` (строка → ObjectId), даты служебных полей — из ISO-строк.
 */
export function parseFilter(raw: string | undefined): Record<string, unknown> {
  if (raw === undefined || raw === '') return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new BadRequestException('filter: некорректный JSON');
  }
  if (!isPlainObject(parsed)) throw new BadRequestException('filter должен быть JSON-объектом');

  const out: Record<string, unknown> = {};
  for (const [rawField, cond] of Object.entries(parsed)) {
    if (rawField.startsWith('$')) {
      throw new BadRequestException(`filter: оператор «${rawField}» запрещён (разрешены только ${FILTER_OPERATORS.join(' ')} внутри поля)`);
    }
    if (!FILTER_FIELD_RE.test(rawField)) {
      throw new BadRequestException(`filter: некорректное имя поля «${rawField}»`);
    }
    const field = rawField === 'id' ? '_id' : rawField;

    const keys = isPlainObject(cond) ? Object.keys(cond) : [];
    const isOperatorObject = keys.length > 0 && keys.some((k) => k.startsWith('$'));
    if (!isOperatorObject) {
      assertLiteral(cond, rawField);
      out[field] = normalizeFieldValue(field, cond);
      continue;
    }

    const ops: Record<string, unknown> = {};
    for (const [op, v] of Object.entries(cond as Record<string, unknown>)) {
      if (!FILTER_OPS.has(op)) {
        throw new BadRequestException(`filter: оператор «${op}» запрещён (разрешены: ${FILTER_OPERATORS.join(' ')})`);
      }
      if (op === '$in' || op === '$nin') {
        if (!Array.isArray(v)) throw new BadRequestException(`filter: «${rawField}.${op}» должен быть массивом`);
        v.forEach((el) => assertLiteral(el, rawField));
        ops[op] = v.map((el) => normalizeFieldValue(field, el));
      } else if (op === '$exists') {
        if (typeof v !== 'boolean') throw new BadRequestException(`filter: «${rawField}.$exists» должен быть true/false`);
        ops[op] = v;
      } else {
        assertLiteral(v, rawField);
        ops[op] = normalizeFieldValue(field, v);
      }
    }
    out[field] = ops;
  }
  return out;
}

// ─── sort / pagination ──────────────────────────────────────────────────

const SORT_FIELD_RE = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)*$/;

/** `sort=field` / `-field`, несколько — через запятую. `id` → `_id`. Всегда добивается `_id` для стабильности. */
export function parseSort(raw: string | undefined): Record<string, 1 | -1> {
  const sort: Record<string, 1 | -1> = {};
  if (raw !== undefined && raw !== '') {
    for (const part of raw.split(',')) {
      const token = part.trim();
      const desc = token.startsWith('-');
      const name = desc ? token.slice(1) : token;
      if (!SORT_FIELD_RE.test(name)) throw new BadRequestException(`sort: некорректное поле «${token}»`);
      sort[name === 'id' ? '_id' : name] = desc ? -1 : 1;
    }
  }
  if (!('_id' in sort)) sort._id = 1;
  return sort;
}

function parsePositiveInt(raw: string | undefined, name: string, fallback: number): number {
  if (raw === undefined || raw === '') return fallback;
  if (!/^\d+$/.test(raw)) throw new BadRequestException(`${name} должен быть положительным целым`);
  const n = Number(raw);
  if (n < 1) throw new BadRequestException(`${name} должен быть ≥ 1`);
  return n;
}

export function parsePagination(page?: string, limit?: string): { page: number; limit: number } {
  const p = parsePositiveInt(page, 'page', 1);
  const l = parsePositiveInt(limit, 'limit', DEFAULT_LIMIT);
  // Больше MAX_LIMIT — урезаем (фактический limit виден в ответе), как в других списках API.
  return { page: p, limit: Math.min(l, MAX_LIMIT) };
}
