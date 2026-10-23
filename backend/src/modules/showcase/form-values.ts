/**
 * Подсказки формы изделия (TASKS ФИ): серии, цвета, размеры — значения, которые уже встречались у изделий,
 * чтобы писать одинаково. Чаще встречавшееся — выше; написание — самое частое из вариантов (без регистра и «ё»).
 */
export type Tally = { value: string; n: number; sub?: string };
const key = (v: string) => v.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
const clean = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();

export function tallyValues(values: unknown[]): Tally[] {
  const by = new Map<string, Map<string, number>>();
  for (const raw of values) {
    const v = clean(raw);
    if (!v) continue;
    const k = key(v);
    const spell = by.get(k) ?? new Map<string, number>();
    spell.set(v, (spell.get(v) ?? 0) + 1);
    by.set(k, spell);
  }
  return [...by.values()].map((spell) => {
    const n = [...spell.values()].reduce((a, b) => a + b, 0);
    const value = [...spell.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ru'))[0][0];
    return { value, n };
  }).sort((a, b) => b.n - a.n || a.value.localeCompare(b.value, 'ru'));
}

/** Добавить значения справочника (цвета, категории каталога), которых ещё нет у изделий: n = 0, sub — откуда. */
export function withDict(list: Tally[], dict: { value: string; sub?: string }[]): Tally[] {
  const have = new Set(list.map((x) => key(x.value)));
  const out = list.map((x) => { const sub = dict.find((d) => key(d.value) === key(x.value))?.sub; return sub ? { ...x, sub } : x; });
  for (const d of dict) { const v = clean(d.value); if (v && !have.has(key(v))) { have.add(key(v)); out.push({ value: v, n: 0, ...(d.sub ? { sub: d.sub } : {}) }); } }
  return out;
}
