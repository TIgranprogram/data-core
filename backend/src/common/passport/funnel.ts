import { matchesAll, searchTokens } from '../text/search-norm';

/**
 * Паспорт «воронкой» (C028): чистая сборка шагов — Категория → Группа → признаки категории → изделие.
 * Ничего не читает из базы: данные приносит `product-passport/passport-funnel.ts`.
 */
export interface FunnelProduct { id: string; sku: string; name: string; cat: string | null; groupId: string | null; group: string | null; valueIds: string[]; photoId: string | null }
export interface FunnelFacet { id: string; code: string; name: string; category: string; order: number; step: boolean; multi: boolean; hint: string }
export interface FunnelValue { id: string; name: string; parentId: string; order: number; words?: string[] }
export interface FunnelInput {
  products: FunnelProduct[]; facets: FunnelFacet[]; values: FunnelValue[]; categories: Array<{ code: string; name: string }>;
  category?: string; group?: string;
  /** Выбранные значения признаков (id) и признаки, где выбрано «не указан» (id признака). */
  selected: string[]; none: string[]; q?: string;
}
export interface FunnelStep { key: string; label: string; multi: boolean; skip: boolean; values: Array<{ id: string; label: string; count: number; thumb?: string }>; none: number }

const s = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();
const byOrder = <T extends { order: number; name: string }>(a: T, b: T) => (a.order - b.order) || a.name.localeCompare(b.name, 'ru');
const ru = (a: { label: string }, b: { label: string }) => a.label.localeCompare(b.label, 'ru');
/** Слова подсказки: «жим|тяг» или массив → список строк в нижнем регистре без «ё» (поиск подстрокой в названии изделия). */
export function parseWords(v: unknown): string[] {
  const raw = Array.isArray(v) ? v.map(String) : s(v).split(/[|;,\n]/);
  return [...new Set(raw.map((w) => s(w).toLowerCase().replace(/ё/g, 'е')).filter(Boolean))];
}
/** Разбор `f=a,b,none:<id признака>` → выбранные значения и признаки «не указан». */
export function parseSelection(raw: unknown): { selected: string[]; none: string[] } {
  const parts = String(raw ?? '').split(',').map((x) => x.trim()).filter(Boolean);
  return { selected: parts.filter((x) => !x.startsWith('none:')), none: parts.filter((x) => x.startsWith('none:')).map((x) => x.slice(5)) };
}

/** Подсказка значения по названию изделия: первое по порядку значение, чей корень слова встретился подстрокой (без регистра и «ё»). */
export function suggestValue(name: string, values: FunnelValue[]): { id: string; label: string; word: string } | null {
  const hay = String(name ?? '').toLowerCase().replace(/ё/g, 'е');
  for (const v of [...values].sort(byOrder)) {
    const word = (v.words ?? []).find((w) => w && hay.includes(w));
    if (word) return { id: v.id, label: v.name, word };
  }
  return null;
}

export function buildFunnel(inp: FunnelInput): { category: string | null; steps: FunnelStep[]; matched: FunnelProduct[]; total: number } {
  const steps: FunnelStep[] = [];
  const all = inp.products;
  // 1. Категория: считаем по всем изделиям
  const catCount = new Map<string, number>();
  for (const p of all) if (p.cat) catCount.set(p.cat, (catCount.get(p.cat) ?? 0) + 1);
  const catValues = inp.categories.filter((c) => catCount.has(c.code)).map((c) => ({ id: c.code, label: c.name, count: catCount.get(c.code)! })).sort(ru);
  steps.push({ key: 'category', label: 'Категория', multi: false, skip: catValues.length <= 1, values: catValues, none: all.filter((p) => !p.cat).length });
  const category = inp.category || (catValues.length === 1 ? catValues[0].id : null);
  let slice = category ? all.filter((p) => p.cat === category) : all;

  // 2. Группа
  const grp = new Map<string, { label: string; count: number; thumb?: string }>();
  for (const p of slice) if (p.groupId) { const g = grp.get(p.groupId) ?? { label: p.group ?? '', count: 0 }; g.count++; if (!g.thumb && p.photoId) g.thumb = p.photoId; grp.set(p.groupId, g); }
  const grpValues = [...grp.entries()].map(([id, g]) => ({ id, label: g.label, count: g.count, ...(g.thumb ? { thumb: g.thumb } : {}) })).sort(ru);
  steps.push({ key: 'group', label: 'Группа', multi: false, skip: grpValues.length <= 1, values: grpValues, none: slice.filter((p) => !p.groupId).length });
  if (inp.group) slice = slice.filter((p) => p.groupId === inp.group);

  // 3. Признаки категории: каждый шаг считается на срезе, суженном предыдущими шагами
  if (category) {
    const byFacet = new Map<string, FunnelValue[]>();
    for (const v of inp.values) byFacet.set(v.parentId, [...(byFacet.get(v.parentId) ?? []), v]);
    for (const f of inp.facets.filter((x) => x.category === category && x.step).sort(byOrder)) {
      const vals = (byFacet.get(f.id) ?? []).sort(byOrder);
      const ids = new Set(vals.map((v) => v.id));
      const count = new Map<string, number>();
      let none = 0;
      for (const p of slice) {
        const mine = p.valueIds.filter((x) => ids.has(x));
        if (!mine.length) none++;
        for (const x of mine) count.set(x, (count.get(x) ?? 0) + 1);
      }
      const chosen = inp.selected.filter((x) => ids.has(x));
      const shown = vals.filter((v) => count.has(v.id) || chosen.includes(v.id)).map((v) => ({ id: v.id, label: v.name, count: count.get(v.id) ?? 0 }));
      steps.push({ key: f.code, label: f.name, multi: f.multi, skip: shown.length <= 1, values: shown, none });
      // выбрано несколько значений признака — изделие должно иметь все; «не указан» — не имеет ни одного
      if (inp.none.includes(f.id)) slice = slice.filter((p) => !p.valueIds.some((x) => ids.has(x)));
      else if (chosen.length) slice = slice.filter((p) => chosen.every((x) => p.valueIds.includes(x)));
    }
  }

  // 4. Изделия: поиск идёт по всем изделиям, шаги его не сужают
  const tokens = searchTokens(inp.q);
  const matched = (tokens.length ? all.filter((p) => matchesAll(tokens, p.name, p.sku)) : slice).slice().sort((a, b) => a.name.localeCompare(b.name, 'ru') || a.sku.localeCompare(b.sku));
  return { category, steps, matched, total: matched.length };
}
