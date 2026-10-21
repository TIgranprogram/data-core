/**
 * Разбор каталога изделий (TASKS БЗ-4): строки таблицы в любом порядке колонок, как лист «Перечень изделий 2026»
 * (Тип · Группа · Артикул · Наименование · Серия; цена — необязательно). Чистая функция — юнит-тесты catalog-rows.spec.ts.
 */
export interface CatalogRow { type: string | null; group: string | null; sku: string; name: string; series: string | null; price: number | null; line: number }

const HEAD: Record<string, keyof CatalogRow> = {
  'тип': 'type', 'раздел': 'type', 'группа': 'group', 'подраздел': 'group', 'артикул': 'sku', 'арт': 'sku', 'код': 'sku',
  'наименование': 'name', 'название': 'name', 'изделие': 'name', 'серия': 'series', 'цена': 'price', 'стоимость': 'price', 'цена, руб': 'price', 'цена, ₽': 'price',
};
const clean = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim();
const num = (s: unknown) => { const t = clean(s).replace(/\s/g, '').replace(',', '.').replace(/[^\d.]/g, ''); const n = Number(t); return t && Number.isFinite(n) && n > 0 ? n : null; };

/** Текст «колонки через Tab» (вставка из Excel или прочитанный файл) → строки каталога + ошибки по строкам. */
export function parseCatalog(text: string) {
  const lines = String(text ?? '').replace(/\r/g, '').split('\n').map((l) => l.split('\t'));
  const hi = lines.findIndex((cells) => cells.some((c) => HEAD[clean(c).toLowerCase()] === 'sku') && cells.some((c) => HEAD[clean(c).toLowerCase()] === 'name'));
  if (hi < 0) return { rows: [] as CatalogRow[], errors: ['Нет строки заголовков с колонками «Артикул» и «Наименование»'] };
  const cols = lines[hi].map((c) => HEAD[clean(c).toLowerCase()] ?? null);
  const rows: CatalogRow[] = []; const errors: string[] = []; const seen = new Map<string, number>();
  let type: string | null = null, group: string | null = null;
  lines.slice(hi + 1).forEach((cells, i) => {
    const r: Record<string, string> = {};
    cols.forEach((k, j) => { if (k) r[k] = clean(cells[j]); });
    const line = hi + i + 2;
    // как в листе: «Тип» и «Группа» пишутся один раз на раздел — тянем вниз
    if (r.type) type = r.type; if (r.group) group = r.group;
    if (!r.sku && !r.name) return;
    if (!r.sku) { errors.push(`Строка ${line}: нет артикула («${r.name}»)`); return; }
    if (!r.name) { errors.push(`Строка ${line}: нет наименования (арт. ${r.sku})`); return; }
    const k = r.sku.toLowerCase();
    if (seen.has(k)) { errors.push(`Строка ${line}: артикул ${r.sku} уже был в строке ${seen.get(k)} — взята первая`); return; }
    seen.set(k, line);
    rows.push({ type, group, sku: r.sku, name: r.name, series: r.series || null, price: num(r.price), line });
  });
  return { rows, errors };
}
