import type { Dims } from './metal';

export interface SectionProfile {
  shape: 'rect' | 'round' | 'unknown';
  widthMm?: number; heightMm?: number; diameterMm?: number; wallMm?: number;
  label: string;
  state: 'complete' | 'incomplete' | 'conflict' | 'unknown';
  source: 'dimensions' | 'assortment' | 'mixed';
}
type SectionRow = { metal?: string | null; assortment?: string | null; dims?: Dims };
type SortRow = SectionRow & { name?: string | null; materialId?: string; sectionProfile?: SectionProfile };
const positive = (n: unknown): number | undefined => Number.isFinite(Number(n)) && Number(n) > 0 ? Number(n) : undefined;
const numberLabel = (n?: number) => n === undefined ? '?' : String(n).replace('.', ',');

/** Пробелы вокруг разделителей только в размерной последовательности, остальные слова не меняются. */
export function compactStockDimensions(value: unknown): string {
  return String(value ?? '').replace(/(?:[Ø⌀Фф]\s*)?\d+(?:[.,]\d+)?(?:\s*[×xх*]\s*\d+(?:[.,]\d+)?){1,2}/giu,
    (size) => size.replace(/\s*[×xх*]\s*/giu, '×').replace(/([Ø⌀Фф])\s+/gu, '$1')
      .replace(/\d+(?:[.,]\d+)?/gu, (n) => String(Number(n.replace(',', '.')))));
}

/** Только сечение: никакой длины, марки и чисел ГОСТ из имени. */
function assortmentProfile(value: string): SectionProfile | null {
  const text = value.trim().replace(/^труба(?:\s+(?:профильная|круглая))?\s*/iu, '').replace(/\s*мм\s*$/iu, '');
  const n = '(\\d+(?:[.,]\\d+)?)';
  const sep = '\\s*[×xх*]\\s*';
  const rect = new RegExp(`^${n}${sep}${n}${sep}${n}$`, 'iu').exec(text);
  const round = new RegExp(`^[Ø⌀Фф]\\s*${n}(?:${sep}${n})?$`, 'iu').exec(text);
  const short = new RegExp(`^${n}${sep}${n}$`, 'iu').exec(text);
  const vals = (m: RegExpExecArray) => m.slice(1).map((v) => v ? positive(v.replace(',', '.')) : undefined);
  if (rect) { const [widthMm, heightMm, wallMm] = vals(rect); return { shape: 'rect', widthMm, heightMm, wallMm, label: '', state: widthMm && heightMm && wallMm ? 'complete' : 'incomplete', source: 'assortment' }; }
  if (round) { const [diameterMm, wallMm] = vals(round); return { shape: 'round', diameterMm, wallMm, label: '', state: diameterMm && wallMm ? 'complete' : 'incomplete', source: 'assortment' }; }
  if (short) { const [widthMm, heightMm] = vals(short); return { shape: 'rect', widthMm, heightMm, label: '', state: 'incomplete', source: 'assortment' }; }
  return null;
}

export function sectionProfile(row: SectionRow): SectionProfile | undefined {
  if (row.metal !== 'pipe') return undefined;
  const dims = row.dims ?? {};
  const parsed = assortmentProfile(String(row.assortment ?? ''));
  const structured: Partial<SectionProfile> = { widthMm: positive(dims.width), heightMm: positive(dims.height), diameterMm: positive(dims.diameter), wallMm: positive(dims.thickness) };
  const hasDims = Object.values(structured).some((v) => v !== undefined);
  const shape = structured.diameterMm ? 'round' : structured.widthMm || structured.heightMm ? 'rect' : parsed?.shape ?? 'unknown';
  const out: SectionProfile = { shape, label: '', state: 'unknown', source: parsed && hasDims ? 'mixed' : hasDims ? 'dimensions' : 'assortment' };
  let conflict = !!(parsed && parsed.shape !== shape);
  for (const key of ['widthMm', 'heightMm', 'diameterMm', 'wallMm'] as const) {
    const a = structured[key], b = parsed?.[key];
    if (a !== undefined && b !== undefined && Math.abs(a - b) > 0.000001) conflict = true;
    if (a !== undefined || b !== undefined) out[key] = a ?? b;
  }
  if (out.diameterMm && (out.widthMm || out.heightMm)) conflict = true;
  const complete = shape === 'rect' ? !!(out.widthMm && out.heightMm && out.wallMm) : shape === 'round' ? !!(out.diameterMm && out.wallMm) : false;
  if (complete && out.wallMm! * 2 >= (shape === 'round' ? out.diameterMm! : Math.min(out.widthMm!, out.heightMm!))) conflict = true;
  out.state = conflict ? 'conflict' : complete ? 'complete' : parsed || hasDims ? 'incomplete' : 'unknown';
  out.label = conflict || shape === 'unknown' ? String(row.assortment ?? '') : shape === 'round'
    ? `Ø${numberLabel(out.diameterMm)}×${numberLabel(out.wallMm)}`
    : `${numberLabel(out.widthMm)}×${numberLabel(out.heightMm)}×${numberLabel(out.wallMm)}`;
  return out;
}

export const DIMENSION_SORT = ['sectionSize', 'sheetSize', 'woodSize', 'thickness', 'width', 'height', 'depth', 'length', 'diameter'] as const;
export const isDimensionSort = (key: string) => (DIMENSION_SORT as readonly string[]).includes(key);
function tuple(row: SortRow, key: string): number[] | null {
  const d = row.dims ?? {};
  if (key === 'sectionSize') {
    const p = row.sectionProfile ?? sectionProfile(row);
    if (!p || p.state !== 'complete') return null;
    return p.shape === 'rect' ? [p.widthMm!, p.heightMm!, p.wallMm!] : [p.diameterMm!, p.wallMm!];
  }
  const sectionAxis = { width: 'widthMm', height: 'heightMm', diameter: 'diameterMm', thickness: 'wallMm' } as const;
  if (row.metal === 'pipe' && key in sectionAxis) {
    const p = row.sectionProfile ?? sectionProfile(row);
    const value = p?.[sectionAxis[key as keyof typeof sectionAxis]];
    return p?.state === 'complete' && positive(value) !== undefined ? [value as number] : null;
  }
  const values = key === 'sheetSize' ? [d.thickness, d.width, d.length] : key === 'woodSize' ? [d.width, d.height ?? d.thickness, d.length] : [d[key as keyof Dims]];
  return values.every((v) => positive(v) !== undefined) ? values as number[] : null;
}

/** Неизвестное — в конец в обоих направлениях; формы сечения имеют фиксированные группы. */
export function compareDimensions(a: SortRow, b: SortRow, key: string, dir: number): number {
  const x = tuple(a, key), y = tuple(b, key);
  if (!x || !y) { if (!!x !== !!y) return x ? -1 : 1; }
  else {
    if (key === 'sectionSize') {
      const rank = (r: SortRow) => (r.sectionProfile ?? sectionProfile(r))?.shape === 'rect' ? 0 : 1;
      const group = rank(a) - rank(b);
      if (group) return group;
    }
    for (let i = 0; i < Math.max(x.length, y.length); i++) if (x[i] !== y[i]) return (x[i] - y[i]) * dir;
  }
  return String(a.name ?? '').localeCompare(String(b.name ?? ''), 'ru') || String(a.materialId ?? '').localeCompare(String(b.materialId ?? ''));
}
