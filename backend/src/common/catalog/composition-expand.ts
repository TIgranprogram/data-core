/**
 * Дерево состава для паспорта и «Взять из состава» (C142 §B).
 * Изделие хранит ссылку на модуль; детали модуля в изделие не копируются.
 * Лист — прямые дети; у модуля раскрывается его состав.
 * Таблица материалов — material по цепочке модуля; у детали со своим составом берётся сырьё, имя детали идёт в части.
 * Вложенное изделие не раскрываем: у него свой паспорт (чужой состав).
 * Без обращений к базе: загрузка — `expandComposition`.
 */
import { Types } from 'mongoose';
import type { SourceRef, SourceStep } from './material-source-refs';

export const COMPOSITION_DEPTH = 8;

export type SheetKind = 'module' | 'part' | 'purchased' | 'product' | 'fastener' | 'raw' | 'material';

export interface CompLine {
  _id?: unknown;
  lineType?: unknown;
  refId?: unknown;
  quantity?: unknown;
  unit?: unknown;
}

export interface CompNode {
  id: string;
  name?: unknown;
  /** Обозначение: sku изделия или модуля, article материала. */
  code?: unknown;
  unit?: unknown;
  materialKind?: unknown;
  isProfile?: unknown;
  composition?: CompLine[];
  /** Старый список материалов модуля, если своего composition нет. */
  materials?: Array<{ materialId?: unknown; quantity?: unknown; unit?: unknown }>;
}

/** Строка блока «Состав» на листе черновика. */
export interface SheetRow {
  kind: SheetKind;
  word: string;
  label: string;
  qty: number;
  unit: string;
  children?: SheetRow[];
}

/** Позиция склада для таблицы материалов. partNames — деталь, внутри которой она лежит. */
export interface StockRef { id: string; partNames: string[]; sourceRefs: SourceRef[] }

const WORD: Record<SheetKind, string> = {
  module: 'Модуль', part: 'Деталь', purchased: 'Покупное', product: 'Изделие', fastener: 'Метиз', raw: 'Сырьё', material: 'Материал',
};

const s = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();

export const sheetLabel = (name?: unknown, code?: unknown) => s(name) || s(code);

/** Уже собранный лист: пустые подписи и нулевое количество не печатаются. Выпущенный снимок проходит как есть. */
export function visibleSheet(rows: unknown): SheetRow[] {
  if (!Array.isArray(rows)) return [];
  const out: SheetRow[] = [];
  for (const raw of rows) {
    const row = (raw ?? {}) as Partial<SheetRow>;
    const label = s(row.label);
    const word = s(row.word);
    const qty = Number(row.qty);
    if (!label || !word || !(qty > 0)) continue;
    const children = visibleSheet(row.children);
    out.push({ kind: row.kind || 'material', word, label, qty, unit: s(row.unit) || 'шт', ...(children.length ? { children } : {}) });
  }
  return out;
}

export function childKind(lineType: string, node?: CompNode): SheetKind {
  if (lineType === 'module') return 'module';
  if (lineType === 'product') return 'product';
  const kind = s(node?.materialKind);
  if (kind === 'part') return 'part';
  if (kind === 'purchased') return 'purchased';
  if (kind === 'fastener') return 'fastener';
  if (kind === 'raw' || node?.isProfile) return 'raw';
  return 'material';
}

/** Строки состава модуля: свой composition, иначе старый список materials. */
export function moduleLines(node?: CompNode): CompLine[] {
  if (!node) return [];
  if (node.composition?.length) return node.composition;
  return (node.materials ?? []).filter((m) => m.materialId).map((m) => ({ lineType: 'material', refId: m.materialId, quantity: m.quantity ?? 1, unit: m.unit }));
}

/**
 * Прямые дети изделия. У модуля — его детали, вложенные модули, покупное и сырьё (не строки изделия).
 * Нет имени — обозначение. Пустая подпись или количество не печатаются.
 */
export function sheetRows(lines: CompLine[], nodes: Map<string, CompNode>, depth = 0, stack: Set<string> = new Set()): SheetRow[] {
  const out: SheetRow[] = [];
  for (const line of lines) {
    const type = s(line.lineType);
    if (type !== 'module' && type !== 'material' && type !== 'product') continue;
    const id = s(line.refId);
    const key = `${type}:${id}`;
    if (!id || stack.has(key)) continue;
    const node = nodes.get(id);
    const kind = childKind(type, node);
    const label = sheetLabel(node?.name, node?.code);
    const qty = Number(line.quantity);
    if (!label || !(qty > 0)) continue;
    const row: SheetRow = { kind, word: WORD[kind], label, qty, unit: s(line.unit) || s(node?.unit) || 'шт' };
    if (type === 'module' && depth < 4) {
      const kids = sheetRows(moduleLines(node), nodes, depth + 1, new Set(stack).add(key));
      if (kids.length) row.children = kids;
    }
    out.push(row);
  }
  return out;
}

const materialLines = (node?: CompNode) => (node?.composition ?? []).filter((l) => s(l.lineType || 'material') === 'material' && l.refId);

/**
 * Позиции склада для «Взять из состава»: прямые material и цепочка модуля до material/детали.
 * Деталь со своим составом в таблицу не идёт — идёт сырьё внутри (имя детали — в partNames).
 * Деталь без состава остаётся сама: иначе модуль из одних деталей даёт пустой список.
 * Вложенное изделие не входит — чужой состав не подмешиваем (ТЗ §B: у изделия свой паспорт).
 */
export function stockRefs(lines: CompLine[], nodes: Map<string, CompNode>, legacyModuleIds: unknown[] = []): StockRef[] {
  const acc = new Map<string, StockRef>();
  const step = (line: CompLine): SourceStep => {
    const node = nodes.get(s(line.refId));
    return { kind: childKind(s(line.lineType), node), refId: s(line.refId), name: s(node?.name), code: s(node?.code), ...(line._id ? { lineId: s(line._id) } : {}) };
  };
  const add = (id: string, path: SourceStep[], partName?: string) => {
    const row = acc.get(id) ?? { id, partNames: [], sourceRefs: [] };
    const list = row.partNames;
    const name = s(partName);
    if (name && !list.includes(name)) list.push(name);
    const source = [...path].reverse().find((p) => p.kind === 'part') ?? path[path.length - 1];
    const ref = { ...source, path };
    if (!row.sourceRefs.some((r) => JSON.stringify(r) === JSON.stringify(ref))) row.sourceRefs.push(ref);
    acc.set(id, row);
  };
  const walkMaterial = (id: string, partName: string | undefined, depth: number, stack: Set<string>, path: SourceStep[]) => {
    if (!id || stack.has(id) || depth > COMPOSITION_DEPTH) return;
    const node = nodes.get(id);
    if (!node) return;
    const inner = materialLines(node);
    const kind = s(node.materialKind);
    if (inner.length && (kind === 'part' || !kind)) {
      stack.add(id);
      const name = sheetLabel(node.name, node.code) || partName;
      for (const line of inner) walkMaterial(s(line.refId), name, depth + 1, stack, [...path, step({ ...line, lineType: 'material' })]);
      stack.delete(id);
      return;
    }
    add(id, path, partName);
  };
  const walk = (rows: CompLine[], depth: number, stack: Set<string>, path: SourceStep[]) => {
    if (depth > COMPOSITION_DEPTH) return;
    for (const line of rows) {
      const type = s(line.lineType);
      const id = s(line.refId);
      if (!id) continue;
      if (type === 'material') walkMaterial(id, undefined, depth, new Set(), [...path, step(line)]);
      else if (type === 'module' && depth < COMPOSITION_DEPTH) {
        const key = `module:${id}`;
        if (stack.has(key)) continue;
        walk(moduleLines(nodes.get(id)), depth + 1, new Set(stack).add(key), [...path, step(line)]);
      }
    }
  };
  const root = lines.length ? lines : legacyModuleIds.map((id) => ({ lineType: 'module', refId: id, quantity: 1 }));
  walk(root, 0, new Set(), []);
  return [...acc.values()];
}

export interface GraphDb {
  collection(name: string): {
    find(filter: Record<string, unknown>, options?: Record<string, unknown>): { toArray(): Promise<Array<Record<string, unknown>>> };
  };
}

const asLines = (v: unknown): CompLine[] => (Array.isArray(v) ? v as CompLine[] : []);

function rootLines(prod: { composition?: unknown; productModuleIds?: unknown }): CompLine[] {
  const composition = asLines(prod.composition);
  if (composition.length) return composition;
  return (Array.isArray(prod.productModuleIds) ? prod.productModuleIds : []).map((id) => ({ lineType: 'module', refId: id, quantity: 1 }));
}

function toNode(doc: Record<string, unknown>, codeKey: 'sku' | 'article'): CompNode {
  return {
    id: String(doc._id), name: doc.name, code: doc[codeKey], unit: doc.unit, materialKind: doc.materialKind, isProfile: doc.isProfile,
    composition: asLines(doc.composition),
    materials: Array.isArray(doc.materials) ? doc.materials as CompNode['materials'] : undefined,
  };
}

/**
 * Дочитывает модули, изделия и материалы по ссылкам (не больше COMPOSITION_DEPTH кругов).
 * `materials` — документы склада для сборки таблицы; лист и позиции считаются здесь же.
 */
export async function expandComposition(db: GraphDb, prod: { composition?: unknown; productModuleIds?: unknown }): Promise<{
  sheet: SheetRow[];
  stock: StockRef[];
  materials: Map<string, Record<string, unknown>>;
}> {
  const root = rootLines(prod);
  const empty = { sheet: [] as SheetRow[], stock: [] as StockRef[], materials: new Map<string, Record<string, unknown>>() };
  if (!root.length) return empty;
  const want = new Map<string, 'module' | 'product' | 'material'>();
  const take = (line: CompLine) => {
    const type = s(line.lineType);
    const id = s(line.refId);
    if (!Types.ObjectId.isValid(id)) return;
    if (type === 'module' || type === 'product' || type === 'material') want.set(id, type);
  };
  for (const line of root) take(line);
  const docs = new Map<string, Record<string, unknown> | null>();
  for (let depth = 0; depth < COMPOSITION_DEPTH && [...want].some(([id]) => !docs.has(id)); depth++) {
    const missing = [...want].filter(([id]) => !docs.has(id));
    const ids = (kind: 'module' | 'product' | 'material') => missing.filter(([, k]) => k === kind).map(([id]) => new Types.ObjectId(id));
    const load = async (name: string, list: Types.ObjectId[], projection: Record<string, number>) =>
      (list.length ? db.collection(name).find({ _id: { $in: list } }, { projection }).toArray() : []);
    const [mods, prods, mats] = await Promise.all([
      load('productmodules', ids('module'), { name: 1, sku: 1, unit: 1, composition: 1, materials: 1 }),
      load('products', ids('product'), { name: 1, sku: 1, unit: 1 }),
      load('materials', ids('material'), { name: 1, article: 1, unit: 1, materialKind: 1, isProfile: 1, assortment: 1, materialGrade: 1, dimensions: 1, passportSpec: 1, composition: 1 }),
    ]);
    const found = new Set<string>();
    for (const doc of [...mods, ...prods, ...mats]) { docs.set(String(doc._id), doc); found.add(String(doc._id)); }
    for (const [id] of missing) if (!found.has(id)) docs.set(id, null);
    for (const doc of mods) for (const line of moduleLines(toNode(doc, 'sku'))) take(line);
    // Сырьё детали дочитываем. Состав вложенного изделия — нет (чужой паспорт).
    for (const doc of mats) {
      const node = toNode(doc, 'article');
      const kind = s(node.materialKind);
      if (materialLines(node).length && (kind === 'part' || !kind)) for (const line of materialLines(node)) take(line);
    }
  }
  const nodes = new Map<string, CompNode>();
  const materials = new Map<string, Record<string, unknown>>();
  for (const [id, doc] of docs) {
    if (!doc) continue;
    const kind = want.get(id);
    nodes.set(id, toNode(doc, kind === 'material' ? 'article' : 'sku'));
    if (kind === 'material') materials.set(id, doc);
  }
  return { sheet: sheetRows(root, nodes), stock: stockRefs(root, nodes), materials };
}
