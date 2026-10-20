import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  StreamableFile,
} from '@nestjs/common';
import { Observable, map } from 'rxjs';

/**
 * T18: единый идентификатор в ответах API.
 *
 * Часть модулей отдаёт mongoose-virtual `id`, часть (lean-запросы каталога) — только `_id`.
 * Interceptor аддитивно добавляет `id` (строка) в каждый объект ответа, где есть `_id`,
 * а `id` ещё нет. Ничего не удаляет и не переименовывает — контракт только расширяется.
 */
const MAX_DEPTH = 10;

function isObjectIdLike(v: unknown): v is { toHexString(): string } {
  return (
    typeof v === 'object' &&
    v !== null &&
    (v as { _bsontype?: string })._bsontype === 'ObjectId' &&
    typeof (v as { toHexString?: unknown }).toHexString === 'function'
  );
}

function idToString(v: unknown): string | undefined {
  if (typeof v === 'string') return v;
  if (isObjectIdLike(v)) return v.toHexString();
  return undefined;
}

export function normalizeIds(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH || value === null || typeof value !== 'object') return value;
  if (value instanceof Date || Buffer.isBuffer(value) || isObjectIdLike(value)) return value;

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) value[i] = normalizeIds(value[i], depth + 1);
    return value;
  }

  // Mongoose-документ: сериализуем так же, как это сделал бы JSON.stringify.
  const maybeDoc = value as { toJSON?: () => unknown; $__?: unknown };
  if (maybeDoc.$__ !== undefined && typeof maybeDoc.toJSON === 'function') {
    return normalizeIds(maybeDoc.toJSON(), depth);
  }

  // Только «простые» объекты — экземпляры прочих классов не трогаем.
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return value;

  const obj = value as Record<string, unknown>;
  for (const key of Object.keys(obj)) obj[key] = normalizeIds(obj[key], depth + 1);
  if (obj._id !== undefined && obj.id === undefined) {
    const id = idToString(obj._id);
    if (id !== undefined) obj.id = id;
  }
  return obj;
}

@Injectable()
export class IdNormalizeInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next
      .handle()
      .pipe(map((body) => (body instanceof StreamableFile ? body : normalizeIds(body))));
  }
}
