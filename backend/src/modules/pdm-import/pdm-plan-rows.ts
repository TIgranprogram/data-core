import type { Types } from 'mongoose';
import { matchKey, matchKeyPdm } from '../../common/catalog/match-key';
import type { PdmItemDto, PdmKind, PdmTreeDto } from './dto/pdm-tree.dto';
import type { PdmFound } from './pdm-import.schema';
import { checkTree, diffComposite, diffPart, dimensionsOf, linesOf, sortamentOf, type DimRow, type FieldConflict, type SiteLine } from './pdm-plan';

/** План загрузки по каждому обозначению (чистая логика; данные базы приходят готовыми в `Lookup`). */

export type PlanAction = 'create' | 'link' | 'suggest' | 'conflict' | 'same';
export type PlanBy = 'article' | 'pdmCode' | 'alias' | 'matchKey';

/** Запись на сайте (materials, productmodules, products), только нужные поля. */
export interface SiteDoc {
  _id: Types.ObjectId;
  updatedAt?: Date | null;
  deletedAt?: Date | null;
  name?: string;
  article?: string;
  sku?: string;
  materialKind?: string | null;
  isProfile?: boolean;
  pdmCode?: string;
  pdmAliases?: string[];
  pdm?: { version?: number; state?: string };
  dimensions?: DimRow[];
  weightKg?: number;
  weightUnit?: string;
  colors?: string[];
  composition?: SiteLine[];
  assortment?: string;
  standardRef?: string;
  materialGrade?: string;
  typeName?: string;
}

export interface Candidate { id: string; article: string; name: string }
export interface PlanRow {
  designation: string;
  kind: PdmKind;
  action: PlanAction;
  targetId?: string;
  by?: PlanBy;
  /** Запись была удалена — при загрузке будет восстановлена. */
  deleted?: boolean;
  candidates?: Candidate[];
  fields?: FieldConflict[];
  fill?: string[];
  notes?: string[];
}
export interface PlanRaw { key: string; name: string; assortment: string; material: string; unit: 'м²' | 'м'; action: 'create' | 'link'; targetId?: string; deleted?: boolean }
export interface Plan { rows: PlanRow[]; raws: PlanRaw[]; blockers: string[]; found: PdmFound[] }

export interface Lookup {
  /** Материалы, найденные по обозначению и его написаниям (article | pdmCode | pdmAliases), с удалёнными. */
  materials: SiteDoc[];
  modules: SiteDoc[];
  products: SiteDoc[];
  /** Все сортаменты (isProfile), с удалёнными. */
  profiles: SiteDoc[];
  /** Кандидаты для сравнения по ключу: ключ → записи. */
  byKey: Map<string, SiteDoc[]>;
}

const idOf = (d: SiteDoc) => String(d._id);
const cand = (d: SiteDoc): Candidate => ({ id: idOf(d), article: d.article ?? d.sku ?? '', name: d.name ?? '' });

/** Ключ записи сайта — той же функцией, что и ключ строки PDM. */
export const siteKey = (d: SiteDoc): string => matchKey({ kind: d.materialKind, typeName: d.typeName, standardRef: d.standardRef, materialGrade: d.materialGrade, assortment: d.assortment, dimensions: d.dimensions, name: d.name });
export const pdmKey = (item: PdmItemDto): string => matchKeyPdm({ kind: item.kind, assortment: String(item.vars?.['Сортамент'] ?? ''), material: String(item.vars?.['Материал'] ?? ''), size: item.size });

/** Точное совпадение метиза/покупного: сначала артикул, потом pdmCode, потом другие написания. */
export function exactHit(item: PdmItemDto, docs: SiteDoc[]): { by: PlanBy; docs: SiteDoc[] } | null {
  const names = new Set([item.designation, ...(item.aliases ?? [])]);
  const levels: Array<[PlanBy, (d: SiteDoc) => boolean]> = [
    ['article', (d) => names.has(d.article ?? '')],
    ['pdmCode', (d) => names.has(d.pdmCode ?? '')],
    ['alias', (d) => (d.pdmAliases ?? []).some((a) => names.has(a))],
  ];
  for (const [by, test] of levels) { const hit = docs.filter(test); if (hit.length) return { by, docs: hit }; }
  return null;
}

const found = (coll: PdmFound['coll'], d: SiteDoc): PdmFound => ({ coll, id: d._id, updatedAt: d.updatedAt ?? null });
const versionChanged = (d: SiteDoc, item: PdmItemDto) => item.file?.version != null && (d.pdm?.version !== item.file.version || d.pdm?.state !== item.file.state);
/** Вес сайта в кг: старые записи без weightUnit хранят граммы (stock/weight.ts weightGOf). */
const siteKg = (d: SiteDoc) => (d.weightKg == null ? d.weightKg : d.weightUnit === 'kg' ? d.weightKg : d.weightKg / 1000);
export const siteOf = (d: SiteDoc) => ({ dimensions: d.dimensions, weightKg: siteKg(d), colors: d.colors, composition: d.composition });

export function buildPlan(tree: PdmTreeDto, look: Lookup): Plan {
  const blockers = checkTree(tree);
  const rows = new Map<string, PlanRow>(), foundList: PdmFound[] = [];
  const target = new Map<string, string>();
  const pick = (docs: SiteDoc[]) => docs.find((d) => !d.deletedAt) ?? docs[0];

  // 1. кого нашли на сайте
  for (const it of tree.items) {
    const row: PlanRow = { designation: it.designation, kind: it.kind, action: 'create' };
    rows.set(it.designation, row);
    if (it.kind === 'fastener' || it.kind === 'purchased') {
      const hit = exactHit(it, look.materials);
      const key = hit ? '' : pdmKey(it);
      const docs = hit ? hit.docs : key ? look.byKey.get(key) ?? [] : [];
      const by: PlanBy = hit ? hit.by : 'matchKey';
      if (docs.length === 1) Object.assign(row, { action: 'link', by, targetId: idOf(docs[0]), deleted: !!docs[0].deletedAt || undefined });
      else if (docs.length > 1) { row.action = 'suggest'; row.by = by; row.candidates = docs.map(cand); docs.forEach((d) => foundList.push(found('materials', d))); }
      if (docs.length === 1) foundList.push(found('materials', docs[0]));
      if (docs.length === 1 && docs[0].isProfile) blockers.push(`«${it.designation}» совпало с сортаментом на сайте — свяжите вручную`);
      continue;
    }
    const pool = it.kind === 'part' ? look.materials.filter((d) => d.article === it.designation) : it.kind === 'module' ? look.modules.filter((d) => d.article === it.designation) : look.products.filter((d) => d.sku === it.designation);
    if (!pool.length) continue;
    const doc = pick(pool);
    if (it.kind === 'part' && doc.materialKind !== 'part') blockers.push(`«${it.designation}» на сайте уже есть, но не как деталь — исправьте на сайте и повторите`);
    Object.assign(row, { action: 'link', by: 'article', targetId: idOf(doc), deleted: !!doc.deletedAt || undefined });
    foundList.push(found(it.kind === 'part' ? 'materials' : it.kind === 'module' ? 'productmodules' : 'products', doc));
  }
  for (const r of rows.values()) if (r.targetId) target.set(r.designation, r.targetId);
  // детали, модули и изделия связаны с записью по точному обозначению — две позиции на одну запись не бывает; метизы (по ключу) могут слиться
  const owners = new Map<string, string[]>();
  for (const [d, id] of target) { const k = rows.get(d)!.kind; if (k !== 'fastener' && k !== 'purchased') owners.set(id, [...(owners.get(id) ?? []), d]); }
  for (const list of owners.values()) if (list.length > 1) blockers.push(`Несколько позиций связаны с одной записью сайта: ${list.join(', ')}`);

  // 2. сортаменты
  const raws = new Map<string, PlanRaw>(), rawTarget = new Map<string, string>();
  const profileByKey = new Map<string, SiteDoc>();
  for (const p of look.profiles) { const k = siteKey(p); if (k && (!profileByKey.has(k) || profileByKey.get(k)!.deletedAt)) profileByKey.set(k, p); }
  for (const it of tree.items) {
    const s = it.kind === 'part' ? sortamentOf(it) : null;
    if (!s || raws.has(s.key)) continue;
    const ex = profileByKey.get(s.key);
    raws.set(s.key, { key: s.key, name: s.name, assortment: s.assortment, material: s.material, unit: s.unit, action: ex ? 'link' : 'create', ...(ex ? { targetId: idOf(ex), deleted: !!ex.deletedAt || undefined } : {}) });
    if (ex) { rawTarget.set(s.key, idOf(ex)); foundList.push(found('materials', ex)); }
  }

  // 3. что отличается (составы считаем по найденным ссылкам; у новых ссылка — «new:…»)
  const refOf = (d: string) => target.get(d) ?? `new:${d}`, rawRefOf = (k: string) => rawTarget.get(k) ?? `new:raw:${k}`;
  const docOf = new Map<string, SiteDoc>();
  for (const d of [...look.materials, ...look.modules, ...look.products, ...[...look.byKey.values()].flat()]) docOf.set(idOf(d), d);
  for (const it of tree.items) {
    const row = rows.get(it.designation)!, notes: string[] = [];
    if (it.kind === 'part') {
      const s = sortamentOf(it), lines = linesOf(tree, it, refOf, rawRefOf);
      if (!s) notes.push('Не указан сортамент');
      else if (!lines.length) notes.push('Нужен размер заготовки');
      if (notes.length) row.notes = notes;
      if (row.action === 'link' && row.targetId) {
        const doc = docOf.get(row.targetId)!, d = diffPart(siteOf(doc), { dimensions: dimensionsOf(it.size), weightKg: it.massKg ?? 0, colors: it.ral ?? [], lines });
        finish(row, d.fill, d.conflicts, !!doc.deletedAt || versionChanged(doc, it));
      }
    } else if (it.kind === 'module' || it.kind === 'product') {
      if (row.action === 'link' && row.targetId) {
        const doc = docOf.get(row.targetId)!, d = diffComposite(doc.composition, linesOf(tree, it, refOf, rawRefOf));
        finish(row, d.fill, d.conflicts, !!doc.deletedAt || versionChanged(doc, it));
      }
    } else if (row.action === 'link' && row.targetId) {
      const doc = docOf.get(row.targetId)!, names = [it.designation, ...(it.aliases ?? [])];
      const known = new Set([doc.pdmCode, ...(doc.pdmAliases ?? [])]);
      if (doc.pdmCode === it.designation && names.every((n) => known.has(n)) && !doc.deletedAt) row.action = 'same';
    }
  }
  return { rows: tree.items.map((i) => rows.get(i.designation)!), raws: [...raws.values()], blockers, found: dedupe(foundList) };
}

function finish(row: PlanRow, fill: string[], conflicts: FieldConflict[], touched: boolean): void {
  if (fill.length) row.fill = fill;
  if (conflicts.length) { row.action = 'conflict'; row.fields = conflicts; } else if (!fill.length && !touched) row.action = 'same';
}

function dedupe(list: PdmFound[]): PdmFound[] {
  const seen = new Set<string>();
  return list.filter((f) => { const k = `${f.coll}:${f.id}`; if (seen.has(k)) return false; seen.add(k); return true; });
}
