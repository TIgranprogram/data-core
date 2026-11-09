import { BadRequestException } from '@nestjs/common';
import { matchKeyPdm } from '../../common/catalog/match-key';
import type { PdmBlankDto, PdmItemDto, PdmKind, PdmTreeDto } from './dto/pdm-tree.dto';

/** Чистая логика загрузки из PDM: проверка дерева, расход сырья, порядок записи, строки состава. Без обращений к базе. */

/** Тип записи в базе для вида позиции PDM. */
export const ownerKindOf = (kind: PdmKind): 'product' | 'module' | 'material' => (kind === 'product' ? 'product' : kind === 'module' ? 'module' : 'material');

const text = (v: unknown): string => (v == null ? '' : String(v).trim());
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

// ───── проверка дерева (CONTRACT §2) ─────

/**
 * Структурные ошибки дерева → 400 (такое дерево приложение присылать не должно). Всё, что можно показать человеку и решить,
 * возвращается списком `blockers` (в предпросмотре) — загрузка с blockers не выполняется.
 */
export function checkTree(tree: PdmTreeDto): string[] {
  const items = new Map<string, PdmItemDto>();
  for (const it of tree.items) {
    // `../`, косые черты и точка в начале обозначения недопустимы (имя попадает в путь к файлам)
    if (it.designation.startsWith('.') || it.designation.includes('..')) throw new BadRequestException(`Недопустимое обозначение: «${it.designation}»`);
    if (items.has(it.designation)) throw new BadRequestException(`Позиция «${it.designation}» указана в дереве дважды — каждая должна быть один раз`);
    items.set(it.designation, it);
  }
  const root = items.get(tree.root);
  if (!root) throw new BadRequestException(`Корень «${tree.root}» не найден среди позиций дерева`);
  if (root.kind !== 'product') throw new BadRequestException(`Корень «${tree.root}» должен быть изделием`);

  const blockers: string[] = [];
  const children = new Map<string, string[]>();
  for (const e of tree.bom) {
    const parent = items.get(e.parent), child = items.get(e.child);
    if (!parent || !child) throw new BadRequestException(`В составе указана неизвестная позиция «${parent ? e.child : e.parent}»`);
    if (!children.has(e.parent)) children.set(e.parent, []);
    children.get(e.parent)!.push(e.child);
    if (parent.kind === 'part' || parent.kind === 'fastener' || parent.kind === 'purchased') blockers.push(`У «${e.parent}» не может быть состава (${labelOf(parent.kind)}); в нём указано «${e.child}»`);
    else if (child.kind === 'product' && parent.kind === 'module') blockers.push(`Изделие «${e.child}» нельзя включить в сборочный модуль «${e.parent}»`);
    else if (child.kind === 'product' && child.designation === tree.root) throw new BadRequestException('Корневое изделие не может входить в состав');
  }
  for (const it of tree.items) {
    if ((it.kind === 'fastener' || it.kind === 'purchased') && it.docs?.length) blockers.push(`У «${it.designation}» (${labelOf(it.kind)}) не должно быть файлов`);
    for (const d of it.docs ?? []) if (d.type === 'dxf' && it.kind !== 'part' && it.kind !== 'module') blockers.push(`Развёртка DXF «${d.name}» у «${it.designation}» не относится к детали`);
  }
  for (const w of tree.warnings ?? []) if (w.code === 'config-conflict' && w.designation) blockers.push(`«${w.designation}»: разные размеры в разных конфигурациях — ${w.text ?? 'решите вручную'}`);
  assertAcyclic(children);
  return blockers;
}

function labelOf(kind: PdmKind): string {
  return { product: 'изделие', module: 'сборочный модуль', part: 'деталь', fastener: 'метиз', purchased: 'покупное' }[kind];
}

function assertAcyclic(children: Map<string, string[]>): void {
  const state = new Map<string, 1 | 2>();
  const visit = (node: string, path: string[]): void => {
    if (state.get(node) === 2) return;
    if (state.get(node) === 1) throw new BadRequestException(`В составе есть цикл: ${[...path, node].join(' → ')}`);
    state.set(node, 1);
    for (const c of children.get(node) ?? []) visit(c, [...path, node]);
    state.set(node, 2);
  };
  for (const n of children.keys()) visit(n, []);
}

/** Порядок записи составов: от листьев к корню (дети раньше родителей). */
export function writeOrder(tree: PdmTreeDto): string[] {
  const children = new Map<string, string[]>();
  for (const e of tree.bom) children.set(e.parent, [...(children.get(e.parent) ?? []), e.child]);
  const out: string[] = [], seen = new Set<string>();
  const visit = (n: string): void => {
    if (seen.has(n)) return;
    seen.add(n);
    for (const c of children.get(n) ?? []) visit(c);
    out.push(n);
  };
  for (const it of tree.items) visit(it.designation);
  return out;
}

// ───── сырьё детали ─────

const SHEET_RE = /^(лист|листов|фанер|плит|пластин)/i;
export interface RawUsage { quantity: number; unit: 'м²' | 'м' }

/** Лист и фанера считаются в м², остальное (труба, брус, прокат) — в метрах. */
export const isSheetAssortment = (assortment: string): boolean => SHEET_RE.test(assortment.trim());
export const rawUnit = (assortment: string): 'м²' | 'м' => (isSheetAssortment(assortment) ? 'м²' : 'м');

const round6 = (x: number) => Math.round(x * 1e6) / 1e6;

/** Расход сырья на одну деталь: лист/фанера — длина × ширина заготовки (м²), труба/брус — длина (м). Нет заготовки — `null`. */
export function rawUsage(assortment: string, blank?: PdmBlankDto | null): RawUsage | null {
  if (!blank || !assortment.trim()) return null;
  const length = num(blank.length), width = num(blank.width);
  if (isSheetAssortment(assortment)) return length > 0 && width > 0 && round6((length * width) / 1e6) > 0 ? { quantity: round6((length * width) / 1e6), unit: 'м²' } : null;
  return length > 0 && round6(length / 1000) > 0 ? { quantity: round6(length / 1000), unit: 'м' } : null;
}

export interface Sortament { key: string; assortment: string; material: string; unit: 'м²' | 'м'; name: string; article: string }

/** Сортамент детали по «Сортамент» + «Материал» карточки. Пустой ключ — сопоставить нечем. */
export function sortamentOf(item: PdmItemDto): Sortament | null {
  const assortment = text(item.vars?.['Сортамент']), material = text(item.vars?.['Материал']);
  const key = matchKeyPdm({ kind: 'raw', assortment, material });
  if (!assortment || !key) return null;
  const name = material ? `${assortment}, ${material}` : assortment;
  return { key, assortment, material, unit: rawUnit(assortment), name, article: `Сортамент: ${name}` };
}

// ───── строки состава ─────

export type LineType = 'module' | 'material' | 'product';
export interface PlannedLine {
  lineType: LineType;
  /** Ссылка: номер существующей записи или `new:<ключ>` для создаваемой — подставляется при записи. */
  ref: string;
  quantity: number;
  sortOrder: number;
  unit?: string;
  overrideDimensions?: { length?: number; width?: number; height?: number; unit: string };
}

const lineTypeOf = (kind: PdmKind): LineType => (kind === 'product' ? 'product' : kind === 'module' ? 'module' : 'material');

/** Сложить строки с одной и той же ссылкой (разные обозначения могли привести к одной записи). */
export function foldLines(lines: Array<Omit<PlannedLine, 'sortOrder'>>): PlannedLine[] {
  const out: PlannedLine[] = [], at = new Map<string, number>();
  for (const l of lines) {
    const key = `${l.lineType}:${l.ref}`, i = at.get(key);
    if (i == null) { at.set(key, out.length); out.push({ ...l, sortOrder: out.length }); } else out[i] = { ...out[i], quantity: round6(out[i].quantity + l.quantity) };
  }
  return out;
}

/**
 * Состав одной позиции дерева.
 * Деталь — одна строка сырья (если есть заготовка и сортамент); остальные — их дети из `bom`.
 * `refOf` даёт ссылку на запись по обозначению, `rawRefOf` — на сортамент.
 */
export function linesOf(tree: PdmTreeDto, item: PdmItemDto, refOf: (designation: string) => string, rawRefOf: (key: string) => string): PlannedLine[] {
  if (item.kind === 'part') {
    const s = sortamentOf(item), use = s ? rawUsage(s.assortment, item.blank) : null;
    if (!s || !use) return [];
    const b = item.blank!, dims: NonNullable<PlannedLine['overrideDimensions']> = { unit: 'мм' };
    if (num(b.length) > 0) dims.length = b.length!;
    if (num(b.width) > 0) dims.width = b.width!;
    if (num(b.thickness) > 0) dims.height = b.thickness!;
    return [{ lineType: 'material', ref: rawRefOf(s.key), quantity: use.quantity, sortOrder: 0, unit: use.unit, overrideDimensions: dims }];
  }
  const kinds = new Map(tree.items.map((i) => [i.designation, i.kind]));
  return foldLines(tree.bom.filter((e) => e.parent === item.designation).map((e) => ({ lineType: lineTypeOf(kinds.get(e.child)!), ref: refOf(e.child), quantity: e.qty })));
}

/** Правила состава (как у CompositionLineService, но по данным в памяти): ошибка текстом или `null`. */
export function checkLines(parent: PdmKind, designation: string, lines: PlannedLine[], kindOf: (line: PlannedLine) => string): string | null {
  for (const l of lines) {
    const k = kindOf(l);
    if (parent === 'part' && (l.lineType !== 'material' || k !== 'raw')) return `В деталь «${designation}» можно добавлять только сырьё`;
    if (parent === 'product' && l.lineType === 'material' && k === 'raw') return `В изделие «${designation}» нельзя добавить сырьё напрямую — только через деталь или сборочный модуль`;
    if (parent === 'module' && l.lineType === 'product') return `Изделие нельзя включить в сборочный модуль «${designation}»`;
  }
  return null;
}

// ───── сравнение «сайт | PDM» ─────

export interface FieldConflict { field: string; site: unknown; pdm: unknown }
export type SiteLine = { lineType: string; refId: unknown; quantity: number; _id?: unknown; [extra: string]: unknown };

const same = (a: number, b: number, eps: number) => Math.abs(a - b) <= eps;

/** Состав сайта и состав PDM: пусто / совпадает / отличается (ссылки сравниваются по строке). */
export function diffLines(site: SiteLine[] | undefined, pdm: Array<Pick<PlannedLine, 'lineType' | 'ref' | 'quantity'>>): 'empty' | 'same' | 'differs' {
  if (!site?.length) return pdm.length ? 'empty' : 'same';
  if (site.length !== pdm.length) return 'differs';
  const have = new Map(site.map((l) => [`${l.lineType}:${String(l.refId)}`, l.quantity]));
  for (const l of pdm) { const q = have.get(`${l.lineType}:${l.ref}`); if (q == null || !same(q, l.quantity, 1e-6)) return 'differs'; }
  return 'same';
}

export type DimRow = { type: string; value: number };
/** Габарит из карточки PDM (мм) → список размеров материала. */
export function dimensionsOf(size?: { length?: number | null; width?: number | null; thickness?: number | null } | null): DimRow[] {
  return (['length', 'width', 'thickness'] as const).flatMap((t) => (num(size?.[t]) > 0 ? [{ type: t, value: size![t] as number }] : []));
}
export const dimsText = (rows: DimRow[] | undefined): string => (rows ?? []).filter((d) => d.value > 0).map((d) => d.value).join('×');
export function dimsSame(a: DimRow[] | undefined, b: DimRow[]): boolean {
  const m = new Map((a ?? []).map((d) => [d.type, d.value]));
  return b.length === (a ?? []).length && b.every((d) => m.has(d.type) && same(m.get(d.type)!, d.value, 0.01));
}

export interface PartSite { dimensions?: DimRow[]; weightKg?: number; colors?: string[]; composition?: SiteLine[] }
export interface PartPdm { dimensions: DimRow[]; weightKg: number; colors: string[]; lines: PlannedLine[] }
export interface PartDiff { fill: string[]; conflicts: FieldConflict[] }

/** Поля существующей детали против PDM: пустое на сайте — заполнить, отличающееся — расхождение для решения человека. */
export function diffPart(site: PartSite, pdm: PartPdm): PartDiff {
  const fill: string[] = [], conflicts: FieldConflict[] = [];
  if (pdm.dimensions.length) {
    if (!site.dimensions?.length) fill.push('dimensions');
    else if (!dimsSame(site.dimensions, pdm.dimensions)) conflicts.push({ field: 'dimensions', site: dimsText(site.dimensions), pdm: dimsText(pdm.dimensions) });
  }
  if (pdm.weightKg > 0) {
    if (!(site.weightKg && site.weightKg > 0)) fill.push('weightKg');
    else if (!same(site.weightKg, pdm.weightKg, 0.0005)) conflicts.push({ field: 'weightKg', site: site.weightKg, pdm: pdm.weightKg });
  }
  if (pdm.colors.length) {
    const a = (site.colors ?? []).map((c) => c.toLowerCase()).sort().join('|'), b = pdm.colors.map((c) => c.toLowerCase()).sort().join('|');
    if (!site.colors?.length) fill.push('colors'); else if (a !== b) conflicts.push({ field: 'colors', site: site.colors.join(', '), pdm: pdm.colors.join(', ') });
  }
  // PDM не дал состава (нет заготовки) — состав на сайте не трогаем и расхождением не считаем
  const c = pdm.lines.length ? diffLines(site.composition, pdm.lines) : 'same';
  if (c === 'empty') fill.push('composition');
  else if (c === 'differs') conflicts.push({ field: 'composition', site: `${site.composition?.length ?? 0} стр.`, pdm: `${pdm.lines.length} стр.` });
  return { fill, conflicts };
}

/** Состав модуля/изделия против PDM. */
export function diffComposite(site: SiteLine[] | undefined, lines: PlannedLine[]): PartDiff {
  const c = lines.length ? diffLines(site, lines) : 'same';
  return { fill: c === 'empty' ? ['composition'] : [], conflicts: c === 'differs' ? [{ field: 'composition', site: `${site?.length ?? 0} стр.`, pdm: `${lines.length} стр.` }] : [] };
}
