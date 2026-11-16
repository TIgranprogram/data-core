import { BadRequestException } from '@nestjs/common';

/**
 * C132: правка «зелёных» строк снимка паспорта (описание, назначение, монтаж, правила, обслуживание) только для этого паспорта.
 * Строка меняется в снимке, исходный текст хранится в `fieldEdits` (там же — прежний источник цвета), `src.<поле>` = manual.
 * Откуда строка пришла (`refs`) — чтобы «Сохранить в справочнике» знало, какую запись менять.
 */
export const SNAPSHOT_FIELDS = ['description', 'purpose', 'install', 'rules', 'maintenance'] as const;
export type SnapshotField = (typeof SNAPSHOT_FIELDS)[number];

/** Источник строки: изделие / запись справочника / раздел воронки; field — поле записи, которое хранит текст. */
export interface FieldRef { kind: 'product' | 'element' | 'material' | 'defect' | 'install' | 'funnel'; id: string; field: string }
/** Ссылки по полям: у rules и maintenance — по одной на строку (maintenance — сквозной номер строки по всем таблицам). */
export interface FieldRefs { description?: FieldRef | null; purpose?: FieldRef | null; install?: FieldRef | null; rules?: Array<FieldRef | null>; maintenance?: Array<FieldRef | null> }
export interface FieldEdit { original: string; src?: string }
export type FieldEdits = { description?: FieldEdit; purpose?: FieldEdit; install?: FieldEdit; rules?: Record<string, FieldEdit>; maintenance?: Record<string, FieldEdit> };

interface Row { what?: string; [k: string]: unknown }
/** Часть снимка, с которой работаем. */
export interface FieldSnap {
  description?: string; purpose?: string; install?: { text?: string; [k: string]: unknown }; rules?: string[];
  maintenance?: Array<{ period?: string; rows: Row[] }>;
  src?: Record<string, unknown>; refs?: FieldRefs; fieldEdits?: FieldEdits;
  [k: string]: unknown;
}

export const MAX_FIELD_TEXT = 4000;
const isScalar = (f: SnapshotField) => f === 'description' || f === 'purpose' || f === 'install';

export function parseField(v: unknown): SnapshotField {
  if (!(SNAPSHOT_FIELDS as readonly string[]).includes(String(v))) throw new BadRequestException(`Поле текста: одно из ${SNAPSHOT_FIELDS.join(', ')}`);
  return v as SnapshotField;
}

/** Сквозной список строк обслуживания: [таблица, строка]. */
const flatRows = (s: FieldSnap) => (s.maintenance ?? []).flatMap((t, ti) => t.rows.map((_, ri) => [ti, ri] as const));

/** Номер строки из тела запроса; у описания, назначения и монтажа номера нет. */
export function parseIndex(field: SnapshotField, snap: FieldSnap, raw: unknown): number | undefined {
  if (isScalar(field)) return undefined;
  const n = Number(raw);
  const size = field === 'rules' ? (snap.rules ?? []).length : flatRows(snap).length;
  if (raw === undefined || raw === null || raw === '' || !Number.isInteger(n) || n < 0 || n >= size) throw new BadRequestException('Строка не найдена в тексте паспорта — обновите карточку');
  return n;
}

export function textAt(snap: FieldSnap, field: SnapshotField, index?: number): string {
  if (field === 'description' || field === 'purpose') return String(snap[field] ?? '');
  if (field === 'install') return String(snap.install?.text ?? '');
  if (field === 'rules') return String((snap.rules ?? [])[index!] ?? '');
  const at = flatRows(snap)[index!];
  return at ? String(snap.maintenance![at[0]].rows[at[1]].what ?? '') : '';
}

function withText(snap: FieldSnap, field: SnapshotField, index: number | undefined, text: string): FieldSnap {
  if (field === 'description' || field === 'purpose') return { ...snap, [field]: text };
  if (field === 'install') return { ...snap, install: { ...(snap.install ?? {}), text } };
  if (field === 'rules') return { ...snap, rules: (snap.rules ?? []).map((r, i) => (i === index ? text : r)) };
  const at = flatRows(snap)[index!];
  return { ...snap, maintenance: snap.maintenance!.map((t, ti) => (ti !== at[0] ? t : { ...t, rows: t.rows.map((r, ri) => (ri === at[1] ? { ...r, what: text } : r)) })) };
}

const editOf = (snap: FieldSnap, field: SnapshotField, index?: number): FieldEdit | undefined => {
  const e = snap.fieldEdits?.[field];
  return isScalar(field) ? (e as FieldEdit | undefined) : (e as Record<string, FieldEdit> | undefined)?.[String(index)];
};

function putEdit(edits: FieldEdits | undefined, field: SnapshotField, index: number | undefined, edit: FieldEdit | null): FieldEdits | undefined {
  const out: FieldEdits = { ...(edits ?? {}) };
  if (isScalar(field)) {
    if (edit) (out as Record<string, FieldEdit>)[field] = edit; else delete out[field as 'description'];
  } else {
    const m = { ...((out[field as 'rules'] as Record<string, FieldEdit> | undefined) ?? {}) };
    if (edit) m[String(index)] = edit; else delete m[String(index)];
    if (Object.keys(m).length) out[field as 'rules'] = m; else delete out[field as 'rules'];
  }
  return Object.keys(out).length ? out : undefined;
}

/** Цвет строки в карточке: описание, назначение и монтаж несут его в `src`. */
const SRC_KEY: Partial<Record<SnapshotField, 'description' | 'purpose' | 'install'>> = { description: 'description', purpose: 'purpose', install: 'install' };

/** Нормализация текста правки: списковая строка — в одну строку, монтаж и описание — с абзацами. */
export function cleanFieldText(field: SnapshotField, raw: unknown): string {
  const t = String(raw ?? '').replace(/\r\n/g, '\n');
  const out = field === 'install' ? t.split('\n').map((l) => l.replace(/[ \t]+/g, ' ').trim()).filter(Boolean).join('\n') : t.replace(/\s+/g, ' ').trim();
  if (!out) throw new BadRequestException('Текст не может быть пустым');
  if (out.length > MAX_FIELD_TEXT) throw new BadRequestException(`Текст длиннее ${MAX_FIELD_TEXT} знаков`);
  return out;
}

/** Правка строки только в этом паспорте. Возвращает новый снимок; вернули исходный текст — пометка снимается. */
export function editField<T extends FieldSnap>(snap: T, field: SnapshotField, index: number | undefined, text: unknown): T {
  const t = cleanFieldText(field, text);
  const cur = textAt(snap, field, index);
  const prev = editOf(snap, field, index);
  const original = prev ? prev.original : cur;
  const key = SRC_KEY[field];
  const next = withText(snap, field, index, t) as T;
  if (t === original) {
    const restored = key && prev ? { ...(next.src ?? {}), [key]: prev.src ?? 'product' } : next.src;
    return { ...next, ...(restored ? { src: restored } : {}), fieldEdits: putEdit(next.fieldEdits, field, index, null) };
  }
  const was = prev ? prev.src : key ? (snap.src?.[key] as string | undefined) : undefined;
  const edit: FieldEdit = { original, ...(was ? { src: was } : {}) };
  return { ...next, ...(key ? { src: { ...(next.src ?? {}), [key]: 'manual' } } : {}), fieldEdits: putEdit(next.fieldEdits, field, index, edit) };
}

/** Что и откуда сохранять в справочник: текст сейчас, прежний текст (для поиска строки в записи), источник. */
export function fieldTarget(snap: FieldSnap, field: SnapshotField, index?: number) {
  const text = textAt(snap, field, index);
  const edit = editOf(snap, field, index);
  const ref = isScalar(field) ? (snap.refs?.[field as 'description'] ?? null) : (snap.refs?.[field as 'rules']?.[index!] ?? null);
  return { text, old: edit?.original ?? text, edited: !!edit, ref };
}

const label = (field: SnapshotField, text: string) => `${({ description: 'Описание', purpose: 'Назначение', install: 'Монтаж', rules: 'Правила', maintenance: 'Обслуживание' })[field]} «${text.slice(0, 60)}${text.length > 60 ? '…' : ''}»`;

/**
 * Пересборка черновика: ручные правки строк переносятся в свежий снимок (C096 для пунктов разделов, здесь — для зелёных строк).
 * Скаляр переносится всегда; строка списка ищется по исходному тексту — исчезла или встречается дважды → конфликт.
 */
export function carryFields<T extends FieldSnap>(prev: FieldSnap | undefined, fresh: T): { snap: T; conflicts: string[] } {
  const edits = prev?.fieldEdits;
  if (!prev || !edits) return { snap: fresh, conflicts: [] };
  let snap: T = fresh;
  const conflicts: string[] = [];
  for (const field of SNAPSHOT_FIELDS) {
    const e = edits[field];
    if (!e) continue;
    if (isScalar(field)) {
      const base = textAt(snap, field);
      const key = SRC_KEY[field]!;
      const was = snap.src?.[key] as string | undefined;
      snap = { ...withText(snap, field, undefined, textAt(prev, field)), src: { ...(snap.src ?? {}), [key]: 'manual' }, fieldEdits: putEdit(snap.fieldEdits, field, undefined, { original: base, ...(was ? { src: was } : {}) }) } as T;
      continue;
    }
    const size = field === 'rules' ? (snap.rules ?? []).length : flatRows(snap).length;
    const taken = new Set<number>();
    for (const [idx, ed] of Object.entries(e as Record<string, FieldEdit>)) {
      const mine = textAt(prev, field, Number(idx));
      const oldRef = fieldTarget(prev, field, Number(idx)).ref;
      const sameRef = (i: number) => { const r = fieldTarget(snap, field, i).ref; return oldRef && r && oldRef.kind === r.kind && oldRef.id === r.id && oldRef.field === r.field; };
      const hits = Array.from({ length: size }, (_, i) => i).filter((i) => (textAt(snap, field, i) === ed.original && (!oldRef || sameRef(i))) || (sameRef(i) && textAt(snap, field, i) === mine));
      if (hits.length !== 1 || taken.has(hits[0])) { conflicts.push(`${label(field, mine)} — ${hits.length ? 'строка встречается несколько раз' : 'строки больше нет в тексте паспорта'}`); continue; }
      taken.add(hits[0]);
      if (textAt(snap, field, hits[0]) === mine) continue;
      snap = { ...withText(snap, field, hits[0], mine), fieldEdits: putEdit(snap.fieldEdits, field, hits[0], { original: ed.original }) } as T;
    }
  }
  return { snap, conflicts };
}
