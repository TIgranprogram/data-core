import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';

/**
 * A2: просмотр записей коллекции в админке (только чтение).
 * Документы приводятся к безопасному JSON: секреты → '***', ObjectId/Date → строки,
 * длинные строки и большие массивы обрезаются, глубина ограничена.
 */
export const DOCS_LIMIT_DEFAULT = 20;
export const DOCS_LIMIT_MAX = 100;
const MAX_STRING = 2000;
const MAX_ARRAY = 100;
const MAX_DEPTH = 8;
export const MASK = '***';

/** Ключ секретный по имени (тот же принцип, что в справочнике полей). */
export function isSecretKey(key: string): boolean {
  if (/(prefix|version|count)$/i.test(key)) return false;
  return /(password|secret|token|apikey|api_key|hash|credential|private)/i.test(key);
}

function isObjectId(v: unknown): v is { toHexString(): string } {
  return (
    v instanceof Types.ObjectId ||
    (typeof v === 'object' && v !== null && (v as { _bsontype?: string })._bsontype === 'ObjectId')
  );
}

export function sanitizeValue(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value ?? null;
  if (isObjectId(value)) return value.toHexString();
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return `<binary ${value.length} bytes>`;
  if (typeof value === 'string') return value.length > MAX_STRING ? value.slice(0, MAX_STRING) + '…' : value;
  if (typeof value !== 'object') return value;
  if (depth >= MAX_DEPTH) return '…';
  if (Array.isArray(value)) {
    const out = value.slice(0, MAX_ARRAY).map((v) => sanitizeValue(v, depth + 1));
    if (value.length > MAX_ARRAY) out.push(`… ещё ${value.length - MAX_ARRAY}`);
    return out;
  }
  // Decimal128 / Long и прочие BSON-типы с toString
  const bson = (value as { _bsontype?: string })._bsontype;
  if (bson) return String(value);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = isSecretKey(k) && v !== null && v !== undefined && v !== '' ? MASK : sanitizeValue(v, depth + 1);
  }
  return out;
}

export type DeletedMode = 'exclude' | 'include' | 'only';

export interface DocsQuery {
  page: number;
  limit: number;
  deleted: DeletedMode;
  q: string;
}

export function parseDocsQuery(raw: { page?: string; limit?: string; deleted?: string; q?: string }): DocsQuery {
  const page = raw.page === undefined ? 1 : Number(raw.page);
  const limit = raw.limit === undefined ? DOCS_LIMIT_DEFAULT : Number(raw.limit);
  if (!Number.isInteger(page) || page < 1) throw new BadRequestException('page — целое число ≥ 1');
  if (!Number.isInteger(limit) || limit < 1) throw new BadRequestException('limit — целое число ≥ 1');
  const deleted = (raw.deleted ?? 'exclude') as DeletedMode;
  if (!['exclude', 'include', 'only'].includes(deleted)) {
    throw new BadRequestException('deleted — exclude | include | only');
  }
  const q = (raw.q ?? '').trim().slice(0, 100);
  return { page, limit: Math.min(limit, DOCS_LIMIT_MAX), deleted, q };
}

/** Поля, по которым ищет строка поиска (если это не id). */
const SEARCH_FIELDS = ['name', 'title', 'label', 'username', 'email', 'article', 'sku', 'key', 'slug', 'code', 'inn', 'displayName', 'fullName'];

export function buildDocsFilter(query: DocsQuery): Record<string, unknown> {
  const parts: Record<string, unknown>[] = [];
  if (query.deleted === 'exclude') parts.push({ deletedAt: null });
  if (query.deleted === 'only') parts.push({ deletedAt: { $ne: null } });
  if (query.q) {
    if (/^[0-9a-f]{24}$/i.test(query.q)) {
      parts.push({ _id: new Types.ObjectId(query.q) });
    } else {
      const rx = { $regex: query.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
      parts.push({ $or: SEARCH_FIELDS.map((f) => ({ [f]: rx })) });
    }
  }
  if (parts.length === 0) return {};
  return parts.length === 1 ? parts[0] : { $and: parts };
}
