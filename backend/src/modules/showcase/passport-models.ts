/**
 * Изделия из паспортов без дублей (TASKS БЗ-8). Модель = «наименование + артикул» из паспортов; похожие модели —
 * группы-кандидаты на объединение (решает пользователь: «Объединить» / «Это разные изделия»). Автоматически не склеиваем:
 * один артикул бывает у разных изделий («Жим от плеч» и «Жим от груди» — 7_38).
 */
export interface PassportModel { key: string; name: string; article: string; n: number; score: number; bestId: string }

/** Слова, которые не отличают изделия: бренд, служебные. */
const STOP = new Set(['street', 'iron', 'для', 'с', 'со', 'на', 'и', 'из', 'в', 'от', 'уличный', 'тренажер', 'тренажёр']);
export const modelKey = (name: string, article: string) => `${name}\u0000${article}`;
const words = (s: string) => new Set(String(s).toLowerCase().replace(/ё/g, 'е').replace(/[«»"'().,;:\-–—/]+/g, ' ').split(/\s+/).filter((w) => w && !STOP.has(w)));

/** Похожесть названий 0…1: общие слова / все слова обоих названий (порядок и бренд не важны; «Скамейка на 5 мест» и «Трибуна на 5 мест» — 0,4). */
export function nameSimilarity(a: string, b: string): number {
  const x = words(a), y = words(b);
  if (!x.size || !y.size) return 0;
  let common = 0;
  for (const w of x) if (y.has(w)) common++;
  return common / (x.size + y.size - common);
}

/** Полнота паспорта — чем больше заполнено, тем лучше вариант для изделия. */
export function passportScore(p: Record<string, unknown>): number {
  const has = (v: unknown) => (Array.isArray(v) ? v.length > 0 : v !== undefined && v !== null && v !== '' && v !== 0);
  return ['height', 'length', 'width', 'weight', 'passportCategory', 'installationTypeId', 'description', 'materials', 'purpose', 'article'].filter((k) => has(p[k])).length
    + (has(p.elements) ? 2 : 0) + (has(p.materialIds) ? 1 : 0) + Math.min(((p.images as unknown[]) || []).length, 4);
}

/**
 * Группы-кандидаты: тот же артикул и похожие названия (≥ 0,6) или очень похожие названия (≥ 0,85) при любом артикуле.
 * В группе первым — лучший вариант (больше паспортов заполнено полнее). Одиночки в группы не попадают.
 */
export function candidateGroups(models: PassportModel[]): PassportModel[][] {
  const parent = models.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < models.length; i++) {
    for (let j = i + 1; j < models.length; j++) {
      const a = models[i], b = models[j];
      const sim = nameSimilarity(a.name, b.name);
      const sameArt = !!a.article && a.article === b.article;
      if ((sameArt && sim >= 0.6) || sim >= 0.85) parent[find(i)] = find(j);
    }
  }
  const by = new Map<number, PassportModel[]>();
  models.forEach((m, i) => { const r = find(i); by.set(r, [...(by.get(r) ?? []), m]); });
  return [...by.values()].filter((g) => g.length > 1)
    .map((g) => g.sort((a, b) => b.score - a.score || b.n - a.n || a.name.localeCompare(b.name, 'ru')))
    .sort((a, b) => a[0].name.localeCompare(b[0].name, 'ru'));
}
