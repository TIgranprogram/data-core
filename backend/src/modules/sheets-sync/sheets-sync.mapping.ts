import { createHash } from 'crypto';

/**
 * Какие листы Google-таблиц куда кладём (то же сопоставление, что было в Apps Script
 * `deploy/google-sheets/datacore-sync.gs`, чтобы данные приложения «Снабжение / Склад» совпадали).
 *
 * Сервер читает таблицу только на чтение, поэтому служебной колонки «ID базы» нет:
 * строку узнаём по ключу `rowKey` — номеру заявки «№», наименованию ТМЦ и т.п.
 * `rowKey: null` — естественного ключа нет (журнал движений): ключ = содержимое строки.
 */
export interface SheetMap {
  sheet: string;
  headerRow: number;
  app: string;
  collection: string;
  /** Без этого поля строка считается пустой и не переносится. */
  requiredHeader: string;
  /** Колонка-ключ строки; null — ключ по содержимому. */
  rowKey: string | null;
  /** Заголовок → поле; неописанные колонки → транслит заголовка. */
  fields: Record<string, string>;
  skip: string[];
  /** Позиции склада: подхватить запись, созданную в приложении, с тем же наименованием. */
  adoptByName?: boolean;
}

export const SHEET_MAPS: SheetMap[] = [
  {
    sheet: 'Снабжение', headerRow: 1, app: 'supply', collection: 'requests', requiredHeader: 'Наименование', rowKey: '№',
    fields: {
      '№': 'num', 'Дата': 'date', 'Категория': 'category', 'Наименование': 'name', 'Ед_изм.': 'unit',
      'Кол-во': 'qty', 'Подал заявку': 'requestedBy', 'Артикул': 'article', 'Цвет': 'color',
      'Поставщик': 'supplier', 'Ссылка': 'link', 'Заказчик': 'customer', 'Примечание': 'note',
      'Статус': 'status', 'Приоритет': 'priority', 'Наша Компания': 'ourCompany', 'Доставка': 'delivery',
      'Тип счета': 'invoiceType', '№ Счета': 'invoiceNo', 'Дата счета': 'invoiceDate', 'Цена с НДС': 'priceWithVat',
    },
    skip: ['Фото', 'ID базы'],
  },
  {
    sheet: 'Реестр счетов', headerRow: 1, app: 'supply', collection: 'invoices', requiredHeader: 'Наименование', rowKey: '№',
    fields: {
      '№': 'num', 'Поставщик': 'supplier', 'Категория': 'category', 'Артикул': 'article', 'Наименование': 'name',
      'Ед_изм.': 'unit', 'Кол-во': 'qty', 'Цена с НДС': 'priceWithVat', 'Тип счета': 'invoiceType', '№ Счета': 'invoiceNo', 'Дата счета': 'invoiceDate',
    },
    skip: ['Фото', 'ID базы'],
  },
  {
    sheet: 'Склад', headerRow: 6, app: 'warehouse', collection: 'items', requiredHeader: 'Наименование ТМЦ', rowKey: 'Наименование ТМЦ',
    fields: {
      'Категория': 'category', 'Наименование ТМЦ': 'name', 'Ед. изм.': 'unit', 'Артикул': 'article', 'Начальный остаток': 'openingQty',
      'Поступило': 'receivedQty', 'Забронировано': 'reservedQty', 'Списано': 'writtenOffQty', 'Текущий остаток': 'currentQty',
      'Свободный остаток': 'freeQty', 'Статус наличия': 'stockStatus', 'Мин. остаток': 'minQty', 'Вес 1 шт.': 'weightKg',
      'Место хранения': 'location',
    },
    skip: ['Фото', 'ID базы'],
    adoptByName: true,
  },
  {
    sheet: 'Движение склада', headerRow: 1, app: 'warehouse', collection: 'movements', requiredHeader: 'Наименование', rowKey: null,
    fields: {}, skip: ['Фото', 'ID базы'],
  },
];

/** Транслит заголовка → camelCase-ключ поля (как dcSlug_ в Apps Script). */
export function slugHeader(h: string): string {
  const map: Record<string, string> = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya' };
  const words = String(h).toLowerCase().split('').map((ch) => (map[ch] !== undefined ? map[ch] : ch)).join('')
    .replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
  if (!words.length) return '';
  const key = words.map((w, i) => (i ? w[0].toUpperCase() + w.slice(1) : w)).join('');
  return /^[a-z]/.test(key) ? key : 'f' + key;
}

/** Нормализация значения ячейки: пустое → undefined, «дд.мм.гггг» → «гггг-мм-дд». */
export function normalizeCell(v: unknown): string | number | boolean | undefined {
  if (v === null || v === undefined) return undefined;
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  let s = String(v).trim();
  if (!s) return undefined;
  let m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(s);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  m = /^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(s);
  if (m) s = `${m[3]}-${m[2]}-${m[1]}T${m[4].padStart(2, '0')}:${m[5]}:${m[6] ?? '00'}`;
  return s;
}

export const normName = (v: unknown) => String(v ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

export function hashDoc(doc: Record<string, unknown>): string {
  const s = JSON.stringify(Object.keys(doc).sort().map((k) => [k, doc[k]]));
  return createHash('md5').update(s, 'utf8').digest('hex');
}

export interface SheetRow {
  key: string;
  doc: Record<string, unknown>;
  hash: string;
}

/**
 * Значения листа (как отдаёт Sheets API: массив строк, первая строка — `headerRow`) → записи.
 * Возвращает строки с ключом и поля, которые даёт лист (только их синхронизация вправе очищать).
 */
export function sheetToRows(values: unknown[][], map: SheetMap): { rows: SheetRow[]; sheetFields: string[] } {
  const headerIdx = map.headerRow - 1;
  const headers = (values[headerIdx] ?? []).map((h) => String(h ?? '').trim());
  const reqIdx = headers.indexOf(map.requiredHeader);
  if (reqIdx < 0) throw new Error(`на листе «${map.sheet}» нет колонки «${map.requiredHeader}» в строке ${map.headerRow}`);
  const keyIdx = map.rowKey ? headers.indexOf(map.rowKey) : -1;
  if (map.rowKey && keyIdx < 0) throw new Error(`на листе «${map.sheet}» нет колонки «${map.rowKey}»`);

  const cols = headers
    .map((h, i) => ({ i, field: h && !map.skip.includes(h) ? map.fields[h] || slugHeader(h) : '' }))
    .filter((c) => c.field);
  const sheetFields = [...new Set(cols.map((c) => c.field))];

  const rows: SheetRow[] = [];
  const used = new Map<string, number>();
  for (const r of values.slice(headerIdx + 1)) {
    if (!r || normalizeCell(r[reqIdx]) === undefined) continue;
    const doc: Record<string, unknown> = {};
    for (const c of cols) {
      const v = normalizeCell(r[c.i]);
      if (v !== undefined) doc[c.field] = v;
    }
    const hash = hashDoc(doc);
    let base = map.rowKey ? (map.rowKey === map.requiredHeader ? normName(r[keyIdx]) : String(normalizeCell(r[keyIdx]) ?? '')) : hash;
    if (!base) base = hash; // пустой «№» — ключ по содержимому
    const n = (used.get(base) ?? 0) + 1;
    used.set(base, n);
    rows.push({ key: n > 1 ? `${base}#${n}` : base, doc, hash });
  }
  return { rows, sheetFields };
}
