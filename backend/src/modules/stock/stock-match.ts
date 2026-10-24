import { normSearch, skuKey } from '../../common/text/search-norm';

/** Позиция склада для сопоставления (только нужные поля). */
export interface SpecMaterial { id: string; name: string; unit?: string; article?: string | null; sku?: string | null; internalArticle?: string | null }
export interface SpecRow { code?: string; name: string; unit?: string }

/** Ключ названия: регистр, «ё», «×/х/x», запятые, скобки, пробелы и точки не важны («Болт М6×40» = «болт m6x40»). */
export const nameKey = (s: unknown) => normSearch(s).replace(/[\s.\-–—_/\\]+/g, '');
/** Единицы: «шт.» = «шт», регистр не важен. */
export const unitKey = (s: unknown) => String(s ?? '').toLowerCase().replace(/ё/g, 'е').replace(/[.\s]/g, '');

export interface SpecIndex { byCode: Map<string, SpecMaterial[]>; byName: Map<string, SpecMaterial[]> }

/** Индексы для сопоставления: один проход по позициям, потом поиск строк без обращений к базе. */
export function buildIndex(mats: SpecMaterial[]): SpecIndex {
  const byCode = new Map<string, SpecMaterial[]>(), byName = new Map<string, SpecMaterial[]>();
  const add = (map: Map<string, SpecMaterial[]>, k: string, m: SpecMaterial) => { if (!k) return; const l = map.get(k) ?? []; if (!l.includes(m)) l.push(m); map.set(k, l); };
  for (const m of mats) {
    for (const c of [m.article, m.sku, m.internalArticle]) add(byCode, c ? skuKey(c) : '', m);
    add(byName, nameKey(m.name), m);
  }
  return { byCode, byName };
}

export type SpecMatch =
  | { kind: 'matched'; by: 'code' | 'name'; material: SpecMaterial }
  | { kind: 'ambiguous'; candidates: SpecMaterial[] }
  | { kind: 'unit'; material: SpecMaterial }
  | { kind: 'none' };

/**
 * Строка файла → позиция склада (СК-5): сначала по коду/артикулу, потом по наименованию.
 * Несколько подходящих — «неоднозначно» (первую не берём); нет — «не найдено» (новую позицию не создаём);
 * единица измерения указана и не совпала — «другая единица».
 */
export function matchRow(idx: SpecIndex, row: SpecRow): SpecMatch {
  const tries: ['code' | 'name', SpecMaterial[] | undefined][] = [
    ['code', row.code?.trim() ? idx.byCode.get(skuKey(row.code)) : undefined],
    ['name', idx.byName.get(nameKey(row.name))],
  ];
  for (const [by, list] of tries) {
    if (!list?.length) continue;
    if (list.length > 1) return { kind: 'ambiguous', candidates: list };
    const material = list[0];
    if (row.unit?.trim() && material.unit && unitKey(row.unit) !== unitKey(material.unit)) return { kind: 'unit', material };
    return { kind: 'matched', by, material };
  }
  return { kind: 'none' };
}

/** Спецификация, загруженная ранее, — по названию брони. */
export const SPEC_PREFIX = 'Спецификация';
export const specGroupName = (d: Date = new Date()) => `${SPEC_PREFIX} ${d.toLocaleDateString('ru-RU')}`;
