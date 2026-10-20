import type { Connection, Schema, SchemaType } from 'mongoose';
import { COLLECTIONS, isSensitive } from '../admin/collections-admin.controller';

/**
 * Самоописание базы для клиентов и ИИ-агентов (GET /api/meta/schema).
 *
 * Источник — Mongoose-модели (а не образцы данных), поэтому поля видны и у пустых таблиц.
 * Секретные поля (пароли, хеши, токены) не попадают в ответ вообще.
 */
export interface MetaField {
  path: string;
  type: string;
  required?: boolean;
  enum?: unknown[];
  ref?: string;
  /** Тип элементов массива (для массивов примитивов / ссылок). */
  itemType?: string;
  /** Поля вложенных документов (массивы поддокументов, вложенные схемы). */
  fields?: MetaField[];
}

export interface MetaCollection {
  model: string;
  collection: string;
  kind: string;
  description: string;
  fields: MetaField[];
}

const MAX_DEPTH = 3;
const SKIP = new Set(['__v']);

function refOf(st: SchemaType): string | undefined {
  const ref = (st.options as { ref?: unknown } | undefined)?.ref;
  if (typeof ref === 'string') return ref;
  if (typeof ref === 'function') return (ref as { name?: string }).name;
  return undefined;
}

function enumOf(st: SchemaType): unknown[] | undefined {
  const ev = (st as unknown as { enumValues?: unknown[] }).enumValues;
  if (Array.isArray(ev) && ev.length) return ev;
  const opt = (st.options as { enum?: unknown } | undefined)?.enum;
  if (Array.isArray(opt) && opt.length) return opt;
  if (opt && typeof opt === 'object' && Array.isArray((opt as { values?: unknown[] }).values)) {
    return (opt as { values: unknown[] }).values;
  }
  return undefined;
}

export function describeSchema(schema: Schema, depth = 0): MetaField[] {
  const out: MetaField[] = [];
  for (const [path, st] of Object.entries(schema.paths)) {
    if (SKIP.has(path) || isSensitive(path)) continue;
    const f: MetaField = { path, type: st.instance };
    if ((st as unknown as { isRequired?: boolean }).isRequired) f.required = true;
    const en = enumOf(st);
    if (en) f.enum = en;
    const ref = refOf(st);
    if (ref) f.ref = ref;

    const sub = (st as unknown as { schema?: Schema }).schema;
    if (sub && depth < MAX_DEPTH) {
      f.fields = describeSchema(sub, depth + 1);
    } else if (st.instance === 'Array') {
      const caster = (st as unknown as { caster?: SchemaType }).caster;
      if (caster) {
        f.itemType = caster.instance;
        const cref = refOf(caster);
        if (cref) f.ref = cref;
        const cen = enumOf(caster);
        if (cen) f.enum = cen;
      }
    }
    out.push(f);
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

export function describeModels(connection: Connection): MetaCollection[] {
  return Object.values(connection.models)
    .map((m) => {
      const collection = m.collection.collectionName;
      const meta = COLLECTIONS[collection];
      return {
        model: m.modelName,
        collection,
        kind: meta?.kind ?? 'core',
        description: meta?.doc ?? '',
        fields: describeSchema(m.schema),
      };
    })
    .sort((a, b) => a.collection.localeCompare(b.collection));
}
