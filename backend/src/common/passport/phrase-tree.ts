/**
 * Дерево текстов паспорта («воронка», ПВ 2026-10-25) — чистые функции без БД. Узел — запись `dict_values` справочника
 * `passportPhrases`. Корень (нет родителя и нет текста) = раздел паспорта (`section`), лист = узел с текстом, глубина ≤ 4.
 * Общее для справочников (проверки при записи) и паспортов (сборка текста по выбору), поэтому лежит в common/.
 */

import { BadRequestException } from '@nestjs/common';

export const MAX_DEPTH = 4;
/** Разделы, текст которых идёт не в нумерованные пункты, а в поля паспорта: purpose → purpose, installation → installationMethod. */
export const FIELD_SECTIONS = ['purpose', 'installation'] as const;

export interface PhraseNode {
  id: string;
  name: string;
  parentId: string | null;
  section: string;
  text: string;
  categories: string;
  allCategories: boolean;
  order: number;
  required: boolean;
  isDefault: boolean;
  installTypeId: string | null;
  slot: number;
}
export interface PhraseTreeNode extends PhraseNode { children: PhraseTreeNode[] }
export type RawNode = Record<string, unknown>;

const str = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();
const num = (v: unknown, d: number) => { const n = Number(v); return Number.isFinite(n) ? n : d; };

/** Запись справочника → узел (id строкой; пустое — по умолчанию). Текст сохраняет переводы строк. */
export function toNode(r: RawNode): PhraseNode {
  return {
    id: String(r.id ?? r._id ?? ''), name: str(r.name), parentId: r.parentId ? String(r.parentId) : null, section: str(r.section),
    text: String(r.text ?? '').trim(), categories: str(r.categories), allCategories: r.allCategories === true || r.allCategories === 'true',
    order: num(r.order, 0), required: r.required === true || r.required === 'true', isDefault: r.isDefault === true || r.isDefault === 'true',
    installTypeId: r.installTypeId ? String(r.installTypeId) : null, slot: Math.max(1, Math.floor(num(r.slot, 1))),
  };
}

/** Узел виден категории: «Для всех» или код в списке. */
export const matchesCategory = (n: PhraseNode, category: string) =>
  n.allCategories || (!!category && n.categories.split(/[,;\s]+/).filter(Boolean).includes(category));

const byOrder = (a: PhraseNode, b: PhraseNode) => (a.order - b.order) || a.name.localeCompare(b.name, 'ru');

/**
 * Лес разделов для категории: корни → варианты → подварианты. Лист виден по своим галочкам, узел с детьми — если виден
 * любой потомок (тупиковые ветки не показываются). category не задана — всё дерево. Порядок — `order`, затем по названию.
 */
export function buildForest(nodes: PhraseNode[], category?: string): PhraseTreeNode[] {
  const kids = new Map<string, PhraseNode[]>();
  const ids = new Set(nodes.map((n) => n.id));
  for (const n of nodes) {
    // узел с несуществующим родителем (родитель в корзине) в дерево не попадает
    if (n.parentId && !ids.has(n.parentId)) continue;
    const k = n.parentId ?? '';
    kids.set(k, [...(kids.get(k) ?? []), n]);
  }
  const grow = (n: PhraseNode, depth: number): PhraseTreeNode | null => {
    const sub = depth < MAX_DEPTH ? (kids.get(n.id) ?? []).sort(byOrder).map((c) => grow(c, depth + 1)).filter((c): c is PhraseTreeNode => !!c) : [];
    const leaf = !(kids.get(n.id) ?? []).length;
    // лист без текста выбрать нечем; раздел без вариантов — тоже
    if (leaf ? depth === 1 || !n.text || (!!category && !matchesCategory(n, category)) : !sub.length) return null;
    return { ...n, children: sub };
  };
  // корень — без родителя и без текста; одиночные «старые» записи с текстом и без родителя — не разделы
  return (kids.get('') ?? []).filter((n) => !n.text).sort(byOrder).map((n) => grow(n, 1)).filter((n): n is PhraseTreeNode => !!n);
}

/** Ответ воронки: узел без служебных полей; раздел (корень) — с ключом раздела и номером пункта. */
export function presentForest(forest: PhraseTreeNode[]) {
  const node = (n: PhraseTreeNode): Record<string, unknown> => ({ id: n.id, name: n.name, ...(n.text ? { text: n.text } : {}), categories: n.categories, allCategories: n.allCategories, order: n.order,
    required: n.required, isDefault: n.isDefault, installTypeId: n.installTypeId, children: n.children.map(node) });
  return forest.map((r) => ({ ...node(r), section: r.section, slot: r.slot }));
}

/** Узел по id внутри корня (включая сам корень). */
export function findIn(root: PhraseTreeNode, id: string): PhraseTreeNode | null {
  if (root.id === id) return root;
  for (const c of root.children) { const f = findIn(c, id); if (f) return f; }
  return null;
}

/** Все листья ветки. */
export function leavesOf(n: PhraseTreeNode): PhraseTreeNode[] {
  return n.children.length ? n.children.flatMap(leavesOf) : [n];
}

/** От узла вниз до листа: единственный вариант — сам; несколько — отмеченный «по умолчанию»; иначе выбора нет (null). */
export function descend(n: PhraseTreeNode): PhraseTreeNode | null {
  if (!n.children.length) return n;
  if (n.children.length === 1) return descend(n.children[0]);
  const def = n.children.find((c) => c.isDefault);
  return def ? descend(def) : null;
}

export interface Resolved {
  /** rootId → выбранный лист (сохранённый выбор или подставленный сам). */
  leaves: Map<string, { leaf: PhraseTreeNode; auto: boolean }>;
  /** Корни без выбора, где варианты есть. */
  unresolved: PhraseTreeNode[];
  /** Корни, где сохранённый выбор не подходит категории / удалён (не заменяется сам — считается недостающим). */
  invalid: string[];
}

/** Выбор по разделам: сохранённый (`textChoices`) проверяется по дереву категории; нет — подставляется единственный / «по умолчанию». */
export function resolveChoices(forest: PhraseTreeNode[], saved: Record<string, unknown> | null | undefined): Resolved {
  const out: Resolved = { leaves: new Map(), unresolved: [], invalid: [] };
  for (const root of forest) {
    const want = saved && saved[root.id] ? String(saved[root.id]) : '';
    if (want) {
      const node = findIn(root, want);
      const leaf = node ? descend(node) : null;
      if (leaf) out.leaves.set(root.id, { leaf, auto: false });
      else { out.invalid.push(root.id); out.unresolved.push(root); }
      continue;
    }
    const leaf = descend(root);
    if (leaf) out.leaves.set(root.id, { leaf, auto: true });
    else out.unresolved.push(root);
  }
  return out;
}

/** Выбор → простой объект { rootId: leafId } (только явные выборы, подставленные сами тоже, если `withAuto`). */
export const choicesObject = (r: Resolved, withAuto = true) =>
  Object.fromEntries([...r.leaves].filter(([, v]) => withAuto || !v.auto).map(([k, v]) => [k, v.leaf.id]));

/** Обязательные разделы без выбора → [{ label, key: 'choice:<rootId>' }]. `skip` — разделы, текст которых набран вручную. */
export function missingChoices(r: Resolved, skip: (root: PhraseTreeNode) => boolean = () => false) {
  return r.unresolved.filter((root) => root.required && !skip(root)).map((root) => ({ label: `Выбор: ${root.name}`, key: `choice:${root.id}` }));
}

/** Глубина узла (корень = 1) по таблице родителей; цикл → Infinity. */
export function depthOf(byId: Map<string, PhraseNode>, id: string): number {
  let d = 0; const seen = new Set<string>();
  for (let cur: string | null = id; cur; cur = byId.get(cur)?.parentId ?? null) {
    if (seen.has(cur)) return Infinity;
    seen.add(cur); d++;
    if (!byId.has(cur)) break;
  }
  return d;
}

/** Корень узла (id) или null при цикле / обрыве. */
export function rootIdOf(byId: Map<string, PhraseNode>, id: string): string | null {
  const seen = new Set<string>();
  let cur: string | undefined = id;
  while (cur) {
    if (seen.has(cur)) return null;
    seen.add(cur);
    const up: string | null | undefined = byId.get(cur)?.parentId;
    if (!up) return byId.has(cur) ? cur : null;
    cur = up;
  }
  return null;
}

/** Высота поддерева (лист = 1). */
function heightOf(kids: Map<string, string[]>, id: string, guard = 0): number {
  if (guard > MAX_DEPTH + 2) return Infinity;
  return 1 + Math.max(0, ...(kids.get(id) ?? []).map((c) => heightOf(kids, c, guard + 1)));
}

/**
 * Проверки при записи узла (чистая): родитель есть, нет цикла, глубина ≤ 4, у узла с детьми нет текста, под листом с текстом
 * вариантов нет. `all` — живые узлы справочника без правимого; `self` — правимый (id нет у нового).
 * Возвращает текст ошибки по-русски или null.
 */
export function checkNode(all: PhraseNode[], self: { id?: string; parentId: string | null; text: string; isDefault?: boolean }): string | null {
  const byId = new Map(all.map((n) => [n.id, n]));
  if (self.parentId) {
    const parent = byId.get(self.parentId);
    if (!parent) return 'Родитель не найден (возможно, он в корзине)';
    if (self.id) {
      for (let cur: string | null = self.parentId, i = 0; cur; cur = byId.get(cur)?.parentId ?? null, i++) {
        if (cur === self.id || i > MAX_DEPTH + 2) return 'Нельзя вложить вариант в самого себя или в свой подвариант';
      }
    }
    if (parent.text) return `У «${parent.name}» есть текст — это конечный вариант. Уберите текст у него, чтобы добавить подварианты`;
  }
  const kids = new Map<string, string[]>();
  for (const n of all) if (n.parentId) kids.set(n.parentId, [...(kids.get(n.parentId) ?? []), n.id]);
  const mine = self.id ? (kids.get(self.id) ?? []) : [];
  if (mine.length && self.text) return 'У узла есть варианты — текст пишется только в конечном варианте';
  const base = self.parentId ? depthOf(byId, self.parentId) : 0;
  if (base + (self.id ? heightOf(kids, self.id) : 1) > MAX_DEPTH) return `Слишком глубоко: не больше ${MAX_DEPTH} уровней (раздел → вариант → подвариант)`;
  if (self.isDefault) {
    const twin = all.find((n) => n.isDefault && (n.parentId ?? null) === self.parentId && n.id !== self.id);
    if (twin) return `Среди этих вариантов «по умолчанию» уже стоит «${twin.name}»`;
  }
  return null;
}

const OID24 = /^[0-9a-f]{24}$/i;
/** Выбор воронки из тела запроса → { id раздела: id варианта }; пустое → null; не id — 400 по-русски. */
export function parseChoices(v: unknown): Record<string, string> | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v !== 'object' || Array.isArray(v)) throw new BadRequestException('Выбор текстов: ожидается объект { раздел: вариант }');
  const out: Record<string, string> = {};
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    const val = String(x ?? '').trim();
    if (!val) continue; // пустое значение = выбор снят
    if (!OID24.test(k) || !OID24.test(val)) throw new BadRequestException('Выбор текстов: раздел и вариант задаются id записей справочника');
    out[k] = val;
  }
  return Object.keys(out).length ? out : null;
}

/** Выбор принимается, если раздел — корень, вариант — конечный узел именно этого раздела. Иначе текст ошибки (по-русски). */
export function checkChoices(nodes: PhraseNode[], choices: Record<string, string>): string | null {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const hasKids = new Set(nodes.map((n) => n.parentId).filter((x): x is string => !!x));
  for (const [root, leaf] of Object.entries(choices)) {
    const r = byId.get(root), l = byId.get(leaf);
    if (!r || r.parentId) return 'Раздел текста не найден в справочнике «Тексты паспорта» (возможно, удалён)';
    if (!l || hasKids.has(leaf) || !l.text) return `Вариант в разделе «${r.name}» не найден или не конечный — выберите вариант с текстом`;
    if (rootIdOf(byId, leaf) !== root) return `Вариант «${l.name}» относится к другому разделу, не к «${r.name}»`;
  }
  return null;
}
