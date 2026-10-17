import { BadRequestException, Controller, Get, Param, Query } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { Roles } from '../../common/decorators/roles.decorator';

/**
 * Data Core — «справочник таблиц» (админ-only).
 *
 * GET /api/admin/collections          — список коллекций (имя, счётчик, ключевые поля)
 * GET /api/admin/collections/:name    — расшифровка одной: поля, типы, примеры, заполненность
 *
 * Зачем: админка показывает структуру БД «как есть» (реальные имена коллекций и
 * полей), чтобы интеграции и агенты видели контракт без доступа к Mongo.
 *
 * Читаем сырые коллекции через драйвер (без Mongoose-моделей и их soft-delete
 * плагина) — нужна реальная структура данных, включая служебные поля.
 */

/** Жёсткие лимиты, чтобы широкая/большая коллекция не раздула ответ. */
const LIST_SAMPLE = 15;
const DETAIL_SAMPLE_DEFAULT = 100;
const DETAIL_SAMPLE_MAX = 1000;
const MAX_FIELDS = 400;
const MAX_KEY_FIELDS = 10;
const MAX_EXAMPLE_LEN = 120;
const MAX_DEPTH = 8;

interface FieldStat {
  path: string;
  types: string[];
  example: unknown;
  present: number;
  /** 0..1 — доля семпла, где поле встречается. */
  completeness: number;
}

/** Человекочитаемые описания ядра Personal Data Core. */
const COLLECTION_DOCS: Record<string, string> = {
  users:
    'Пользователи. Логин, хеш пароля, роль, права, isActive. Хеш пароля никогда не покидает API.',
  roles: 'Роли доступа (admin / manager / user) и назначенные им права.',
  permissions: 'Справочник прав, которые раздаются ролям и пользователям.',
  settings: 'Служебные настройки системы (ключ → значение).',
  featureflags: 'Переключатели функций (feature flags).',
  auditlogs:
    'Журнал аудита: кто и что изменил (action, entityType, снапшот до/после).',
  desktoppairingkeys:
    'Машинные API-ключи kppd_… На сервере хранится только хеш; есть TTL и отзыв.',
  ratelimits: 'Счётчики rate-limiting (по пользователю / IP).',
  counters: 'Транзакционные счётчики порядковых номеров документов (rs0).',
};

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[_\-\s]/g, '');
}

function describe(name: string): string | undefined {
  return COLLECTION_DOCS[normalizeName(name)];
}

function classify(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (Array.isArray(value)) return 'array';
  if (value instanceof Date) return 'date';
  if (value instanceof Types.ObjectId) return 'objectId';
  if (Buffer.isBuffer(value)) return 'binary';
  const ctor = (value as { constructor?: { name?: string } } | null)?.constructor;
  if (typeof value === 'object' && value !== null && ctor?.name === 'ObjectId') {
    return 'objectId';
  }
  return typeof value; // string | number | boolean | object
}

function trimExample(value: unknown): unknown {
  if (typeof value === 'string' && value.length > MAX_EXAMPLE_LEN) {
    return value.slice(0, MAX_EXAMPLE_LEN) + '...';
  }
  return value;
}

/** Чувствительные поля: тип и заполненность показываем, значение — нет. */
const SENSITIVE_RE = /(password|secret|token|apikey|api_key|hash|credential|private)/i;

function isSensitive(path: string): boolean {
  // tokenPrefix / refreshTokenVersion — витринные значения, не секреты
  if (/(prefix|version|count)$/i.test(path)) return false;
  return SENSITIVE_RE.test(path);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !(value instanceof Date) &&
    !(value instanceof Types.ObjectId) &&
    !Buffer.isBuffer(value) &&
    !Array.isArray(value)
  );
}

/** Обходит один документ и возвращает map: путь -> { типы, пример }. */
function inspectDoc(
  doc: Record<string, unknown>,
): Map<string, { types: Set<string>; example: unknown }> {
  const local = new Map<string, { types: Set<string>; example: unknown }>();

  const visit = (value: unknown, path: string, depth: number): void => {
    if (depth > MAX_DEPTH) return;
    const type = classify(value);
    let entry = local.get(path);
    if (!entry) {
      entry = { types: new Set<string>(), example: undefined };
      local.set(path, entry);
    }
    entry.types.add(type);
    if (
      entry.example === undefined &&
      value !== null &&
      value !== undefined &&
      type !== 'object' &&
      type !== 'array'
    ) {
      entry.example = trimExample(value);
    }
    // Массивы: показываем первые элементы, иначе в справочнике будет «—»
    if (type === 'array' && entry.example === undefined && Array.isArray(value)) {
      if (value.length === 0) entry.example = '[]';
      else {
        try { entry.example = trimExample(JSON.stringify(value.slice(0, 5))); }
        catch { entry.example = '[…]'; }
      }
    }

    if (type === 'object' && isPlainObject(value)) {
      for (const [k, v] of Object.entries(value)) {
        visit(v, path ? path + '.' + k : k, depth + 1);
      }
    } else if (Array.isArray(value)) {
      // Превью под-структур по первым элементам массива: path[].sub
      for (const el of value.slice(0, 5)) {
        if (isPlainObject(el)) visit(el, path + '[]', depth + 1);
      }
    }
  };

  for (const [k, v] of Object.entries(doc)) visit(v, k, 0);
  return local;
}

/** Семплирует документы и сводит статистику полей. */
function collectFields(docs: unknown[]): {
  fields: FieldStat[];
  sampled: number;
  truncated: boolean;
} {
  const map = new Map<string, FieldStat>();
  let sampled = 0;

  for (const doc of docs) {
    if (!isPlainObject(doc)) continue;
    sampled += 1;
    for (const [path, info] of inspectDoc(doc)) {
      let stat = map.get(path);
      if (!stat) {
        stat = { path, types: [], example: undefined, present: 0, completeness: 0 };
        map.set(path, stat);
      }
      for (const t of info.types) if (!stat.types.includes(t)) stat.types.push(t);
      if (stat.example === undefined) stat.example = info.example;
      stat.present += 1;
    }
  }

  const fields = [...map.values()].map((f) => ({
    ...f,
    example: isSensitive(f.path) ? '***' : f.example,
    completeness: sampled > 0 ? f.present / sampled : 0,
  }));
  // Важные поля (высокая заполненность) — впереди, внутри — по алфавиту.
  fields.sort((a, b) => b.completeness - a.completeness || a.path.localeCompare(b.path));

  const truncated = fields.length > MAX_FIELDS;
  return { fields: fields.slice(0, MAX_FIELDS), sampled, truncated };
}

/** Верхнеуровневые поля + типы — дешёвое превью для свёрнутой строки. */
function topLevelPreview(docs: unknown[]): { name: string; types: string[] }[] {
  const map = new Map<string, Set<string>>();
  for (const doc of docs) {
    if (!isPlainObject(doc)) continue;
    for (const [k, v] of Object.entries(doc)) {
      let set = map.get(k);
      if (!set) {
        set = new Set<string>();
        map.set(k, set);
      }
      set.add(classify(v));
    }
  }
  return [...map.entries()]
    .map(([name, types]) => ({ name, types: [...types] }))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, MAX_KEY_FIELDS);
}

@Controller('admin/collections')
export class CollectionsAdminController {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  private db() {
    const db = this.connection?.db;
    if (!db) throw new BadRequestException('MongoDB is not connected');
    return db;
  }

  /** GET /api/admin/collections — быстрый список всех коллекций. */
  @Get()
  @Permissions('user:admin')
  @Roles('admin')
  async list() {
    const db = this.db();
    const raw = await db.listCollections({}, { nameOnly: true }).toArray();
    const names = raw
      .map((c) => c.name)
      .filter((n) => n && !n.startsWith('system.'))
      .sort((a, b) => a.localeCompare(b));

    const items: {
      name: string;
      count: number;
      fieldCount: number;
      keyFields: { name: string; types: string[] }[];
      description?: string;
    }[] = [];

    for (const name of names) {
      const coll = db.collection(name);
      const count = await coll.estimatedDocumentCount().catch(() => 0);
      const sample = await coll.find({}).limit(LIST_SAMPLE).toArray();
      const preview = topLevelPreview(sample);
      items.push({
        name,
        count,
        fieldCount: preview.length,
        keyFields: preview,
        description: describe(name),
      });
    }

    return { total: items.length, items };
  }

  /** GET /api/admin/collections/:name — расшифровка одной коллекции. */
  @Get(':name')
  @Permissions('user:admin')
  @Roles('admin')
  async detail(@Param('name') name: string, @Query('sample') sampleParam?: string) {
    if (!name || !/^[A-Za-z0-9_\-]+$/.test(name)) {
      throw new BadRequestException('Invalid collection name');
    }
    const db = this.db();
    const known = (await db.listCollections({ name }, { nameOnly: true }).toArray()).length > 0;
    if (!known) throw new BadRequestException('Collection not found: ' + name);

    let sampleSize = DETAIL_SAMPLE_DEFAULT;
    if (sampleParam !== undefined) {
      const n = Number(sampleParam);
      if (!Number.isFinite(n) || n < 1) {
        throw new BadRequestException('sample must be a positive number');
      }
      sampleSize = Math.min(Math.floor(n), DETAIL_SAMPLE_MAX);
    }

    const coll = db.collection(name);
    const count = await coll.estimatedDocumentCount().catch(() => 0);
    const docs = await coll.find({}).limit(sampleSize).toArray();
    const { fields, sampled, truncated } = collectFields(docs);

    return {
      name,
      count,
      sampled,
      truncated,
      description: describe(name),
      fields,
    };
  }
}
