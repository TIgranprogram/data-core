/**
 * Каталог поставщиков: чистый разбор Excel-листа (без БД) и сравнение с имеющейся позицией.
 * Шаблон: «Артикул поставщика*, Название у поставщика*, Цвет, Ед. изм., Цена, Дата цены, Группа,
 * Наш артикул, Наше название, Примечание» + необязательная «ИНН поставщика». Старый прайс (7 колонок) принимается.
 */
export const MAX_IMPORT_ROWS = 5000;

export type CatField = 'article' | 'name' | 'color' | 'unit' | 'price' | 'priceDate' | 'optGroup' | 'ourArticle' | 'ourName' | 'note' | 'inn' | 'supplier' | 'skip';

const HEADERS: Record<string, CatField> = {
  'артикул поставщика': 'article', 'артикул': 'article',
  'название у поставщика': 'name', 'название': 'name', 'наименование': 'name', 'описание': 'name',
  'цвет': 'color',
  'ед. изм.': 'unit', 'ед.изм.': 'unit', 'ед': 'unit', 'ед.': 'unit', 'единица': 'unit',
  'цена': 'price', 'цена за 1 штуку': 'price',
  'дата цены': 'priceDate',
  'группа': 'optGroup', 'оптовая группа': 'optGroup',
  'наш артикул': 'ourArticle', 'наше название': 'ourName',
  'примечание': 'note',
  'инн поставщика': 'inn', 'инн': 'inn',
  'кол-во': 'skip', 'кол-во штук': 'skip', 'количество': 'skip', 'остаток': 'skip', 'фото': 'skip', '№': 'skip', 'сумма': 'skip', 'поставщик': 'supplier',
};

/** Колонки шаблона в порядке файла (экспорт — те же + «Остаток» в конце). */
export const TEMPLATE_COLUMNS: Array<{ field: CatField; title: string; width: number }> = [
  { field: 'article', title: 'Артикул поставщика*', width: 22 },
  { field: 'name', title: 'Название у поставщика*', width: 40 },
  { field: 'color', title: 'Цвет', width: 14 },
  { field: 'unit', title: 'Ед. изм.', width: 10 },
  { field: 'price', title: 'Цена', width: 12 },
  { field: 'priceDate', title: 'Дата цены', width: 13 },
  { field: 'optGroup', title: 'Группа', width: 18 },
  { field: 'ourArticle', title: 'Наш артикул', width: 18 },
  { field: 'ourName', title: 'Наше название', width: 32 },
  { field: 'note', title: 'Примечание', width: 28 },
];

export interface CatRow {
  rowNum: number;
  article: string;
  name: string;
  color: string;
  unit: string;
  price: number | null;
  priceDate: Date | null;
  optGroup: string;
  ourArticle: string;
  ourName: string;
  note: string;
  inn: string;
  /** Название поставщика из файла (экспорт); пусто — берём выбранного в окне. */
  supplier: string;
  errors: string[];
}

/** Текст ячейки ExcelJS: строка, число, дата, формула, rich-text, ссылка. */
export function cellText(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (Array.isArray(o.richText)) return (o.richText as Array<{ text?: string }>).map((t) => t.text ?? '').join('').trim();
    if ('result' in o) return cellText(o.result);
    if ('text' in o) return cellText(o.text);
    return '';
  }
  return String(v).trim();
}

/** «640,00 р.» / «8 200 р.» → число; пусто или не число → null. */
export function parsePrice(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) && v >= 0 ? v : null;
  const t = cellText(v);
  if (!t) return null;
  const s = t.replace(/руб\.?|р\.?|₽/gi, '').replace(/\s| /g, '').replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  return parseFloat(s);
}

/** Дата: Date, «ДД.ММ.ГГГГ», «ГГГГ-ММ-ДД»; иначе null. */
export function parseDate(v: unknown): Date | null {
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  const t = cellText(v);
  let m = t.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/);
  if (m) return mkDate(+m[3], +m[2], +m[1]);
  m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return mkDate(+m[1], +m[2], +m[3]);
  return null;
}
function mkDate(y: number, mo: number, d: number): Date | null {
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d ? dt : null;
}

/** Цвет в ключе: пусто / «—» / «-» = без цвета. */
export function normColor(c: unknown): string {
  const t = cellText(c);
  return /^[-–—]+$/.test(t) ? '' : t;
}

/** ИНН: 10 или 12 цифр; «БЕЗ-ИНН-…» и прочее — игнорируется (пустая строка). */
export function cleanInn(v: unknown): string {
  const t = cellText(v).replace(/\s/g, '');
  return /^(\d{10}|\d{12})$/.test(t) ? t : '';
}

/** Ключ позиции в рамках поставщика: артикул + цвет без регистра. */
export const itemKey = (article: unknown, color: unknown) => `${cellText(article).toLowerCase()}|${normColor(color).toLowerCase()}`;

/**
 * Разбор матрицы значений листа. Заголовок — первая строка, где есть колонка «Артикул…».
 * Ошибочные строки возвращаются с `errors` (остальные применяются).
 */
export function parseSheet(matrix: unknown[][]): { rows: CatRow[]; headerRow: number } {
  let headerRow = -1;
  const col: Partial<Record<CatField, number>> = {};
  for (let r = 0; r < matrix.length && headerRow < 0; r++) {
    const found: Partial<Record<CatField, number>> = {};
    (matrix[r] ?? []).forEach((cell, c) => {
      const f = HEADERS[cellText(cell).toLowerCase().replace(/\*/g, '').trim()];
      if (f && f !== 'skip' && found[f] === undefined) found[f] = c;
    });
    if (found.article !== undefined) { headerRow = r; Object.assign(col, found); }
  }
  if (headerRow < 0) return { rows: [], headerRow: -1 };

  const rows: CatRow[] = [];
  const get = (line: unknown[], f: CatField) => (col[f] === undefined ? undefined : line[col[f]!]);
  for (let r = headerRow + 1; r < matrix.length; r++) {
    const line = matrix[r] ?? [];
    const article = cellText(get(line, 'article'));
    const name = cellText(get(line, 'name'));
    const priceRaw = get(line, 'price');
    const dateRaw = get(line, 'priceDate');
    const any = line.some((c) => cellText(c));
    if (!any) continue;
    const low = article.toLowerCase();
    if (low.startsWith('итого') || low.startsWith('стоимость')) continue;
    const errors: string[] = [];
    if (!article) errors.push('нет артикула поставщика');
    if (!name) errors.push('нет названия');
    const price = parsePrice(priceRaw);
    if (cellText(priceRaw) && price === null) errors.push('цена не число');
    const priceDate = parseDate(dateRaw);
    if (cellText(dateRaw) && !priceDate) errors.push('дата цены не распознана');
    rows.push({
      rowNum: r + 1, article, name, color: normColor(get(line, 'color')),
      unit: cellText(get(line, 'unit')), price, priceDate,
      optGroup: cellText(get(line, 'optGroup')), ourArticle: cellText(get(line, 'ourArticle')),
      ourName: cellText(get(line, 'ourName')), note: cellText(get(line, 'note')),
      inn: cleanInn(get(line, 'inn')), supplier: cellText(get(line, 'supplier')), errors,
    });
  }
  return { rows, headerRow };
}

export type RowStatus = 'error' | 'new' | 'price' | 'update' | 'same';

export interface ExistingItem { name?: string; unit?: string; optGroup?: string; note?: string; priceHint?: number | null; materialId?: string | null }

/** Статус строки относительно имеющейся позиции. `materialId` — найденный по «Нашему артикулу» (null — не найден). */
export function classifyRow(row: CatRow, ex: ExistingItem | undefined, materialId: string | null): RowStatus {
  if (row.errors.length) return 'error';
  if (!ex) return 'new';
  if (row.price !== null && row.price !== (ex.priceHint ?? null)) return 'price';
  const same =
    row.name === (ex.name ?? '') &&
    (row.unit || '') === (ex.unit ?? '') &&
    row.optGroup === (ex.optGroup ?? '') &&
    row.note === (ex.note ?? '') &&
    (!materialId || materialId === (ex.materialId ?? null));
  return same ? 'same' : 'update';
}
