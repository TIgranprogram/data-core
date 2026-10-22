/**
 * Правила паспортов без БД (TASKS ПС.2–ПС.5; тесты — passport-rules.spec.ts): номера и талон, чистка текста
 * при переносе, разнос «Объекта», сборка описания, полнота перед выдачей. Используются сервисом и
 * скриптом переноса scripts/import-passports.js (через dist).
 */

/** Гарантийный талон: ГГГГМ-№, месяц без ведущего нуля (как в таблице: 20258-224, 202610-549). Дата — UTC-полночь дня. */
export function warrantyCodeFor(date: Date, passportNo: number | string): string {
  return `${date.getUTCFullYear()}${date.getUTCMonth() + 1}-${passportNo}`;
}

/** «Сегодня» как UTC-полночь (даты паспортов — без времени). */
export function dayUtc(d = new Date()): Date {
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
}

/** Минимальный интерфейс коллекции счётчиков — чтобы проверить атомарность без Mongo. */
export interface CounterColl {
  findOneAndUpdate(filter: object, update: object[], opts: object): Promise<unknown>;
}

/**
 * Следующее значение счётчика `counters{entity:'passport', prefix:key}`: max(текущий, floor) + 1 — одним атомарным
 * обновлением (pipeline, Mongo 4.2+). floor — максимум, уже лежащий в паспортах (перенос из таблицы, ручной ввод),
 * так счётчик никогда не выдаст занятый номер. Два создателя одновременно получают разные значения.
 */
export async function nextSeq(coll: CounterColl, key: string, floor: number): Promise<number> {
  const r = await coll.findOneAndUpdate(
    { entity: 'passport', prefix: key, year: 0 },
    [{ $set: { seq: { $add: [{ $max: [{ $ifNull: ['$seq', 0] }, floor] }, 1] } } }],
    { upsert: true, returnDocument: 'after' },
  );
  const doc = (r && typeof r === 'object' && 'value' in (r as object) ? (r as { value: unknown }).value : r) as { seq?: number } | null;
  return Number(doc?.seq);
}

// ─── Чистка текста при переносе (аудит §3: 5, 6, 8, 11) ─────────────────────────────────────────────

/** Пробелы, кавычки, знаки препинания. Опечатки здесь НЕ правятся — только по утверждённому словарю (applyDict). */
export function cleanText(raw: unknown): string {
  let s = String(raw ?? '').replace(/ /g, ' ').replace(/\r/g, '');
  s = s.replace(/\\"/g, '"');
  s = s.replace(/"([^"\n]*)"/g, '«$1»'); // парные прямые кавычки → ёлочки
  s = s.replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').trim();
  s = s.replace(/ +([,.;:!?)])/g, '$1'); // пробел перед знаком: «комплект , без» → «комплект, без»
  s = s.replace(/\( +/g, '(');
  s = s.replace(/, *\(/g, ' ('); // «волейбольные, (комплект» → «волейбольные (комплект»
  s = s.replace(/([а-яё)»])\.([А-ЯЁ])/g, '$1. $2'); // «условиях.Изделие» → «условиях. Изделие»
  s = s.replace(/,(?=[А-Яа-яЁё])/g, ', ');
  s = s.replace(/([А-Яа-яЁёA-Za-z0-9.,])«/g, '$1 «'); // «воркаут«STREET» → «воркаут «STREET»
  s = s.replace(/([а-яё])\(/g, '$1 ('); // «ступней(д» → «ступней (д»
  return s;
}

/** Утверждённый пользователем словарь опечаток: { «Скамяь»: «Скамья» } — только целые слова. */
export function applyDict(s: string, dict: Record<string, string>): string {
  let out = s;
  for (const [from, to] of Object.entries(dict)) out = out.replace(new RegExp(`(^|[^А-Яа-яЁёA-Za-z])${from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[^А-Яа-яЁёA-Za-z])`, 'g'), `$1${to}`);
  return out;
}

/** Опечатки, замеченные в аудите, — ПРЕДЛОЖЕНИЕ (в словарь попадают только после «да» пользователя). */
export const SUGGESTED_TYPOS: Record<string, string> = {
  Скамяь: 'Скамья', Качли: 'Качели', двайная: 'двойная', колиткой: 'калиткой', деского: 'детского', усиленнным: 'усиленным',
};

/** «176,7» → 176.7; пусто → undefined; мусор → NaN (в отчёт). */
export function parseDecimal(raw: unknown): number | undefined {
  const s = String(raw ?? '').replace(/\s/g, '').replace(',', '.');
  if (!s) return undefined;
  return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : NaN;
}

/** «15.08.2025» → UTC-полночь; иначе undefined. */
export function parseRuDate(raw: unknown): Date | undefined {
  const m = String(raw ?? '').trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (!m) return undefined;
  const d = new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
  return d.getUTCDate() === +m[1] ? d : undefined;
}

// ─── «Объект» → заказчик / № заказа / адрес (аудит §3.9) ────────────────────────────────────────────

//  в JS не знает кириллицу — границы слов явно
const ORG_RE = /^(ИП|ООО|ОАО|ЗАО|АО|ПАО|МБОУ|МАОУ|МБДОУ|МАДОУ|МКОУ|МОУ|ГБОУ|МБУ|МАУ|МКУ|ГБУ|ГКУ|ФГБУ|ДЮСШ|ТСЖ|УК)(?=$|[\s.,«"])/i;
const ADDR_RE = /(?:^|[\s,(])(ул\.|улица|п\.|пос\.|посёлок|поселок|ст\.|ст-ца|станица|х\.|хутор|г\.|город|с\.|село|р-н|район|пр\.|пер\.|мкр|д\.\s*\d)|,\s*\d+\s*$/i;

export interface ObjectParts { customerName?: string; orderNo?: string; objectName?: string; note?: string; kind: 'address' | 'customer' | 'order' | 'unknown' | 'empty' }

/** Разнос свободного «Объекта». Результат — ПРЕДЛОЖЕНИЕ: в отчёт на утверждение, сопоставление с контрагентами — отдельно. */
export function splitObject(raw: unknown): ObjectParts {
  let s = cleanText(raw).replace(/\n/g, ' ');
  if (!s) return { kind: 'empty' };
  const out: ObjectParts = { kind: 'unknown' };
  const ord = s.match(/Заказ\s*№?\s*(\d[\d/-]*)/i);
  if (ord) { out.orderNo = ord[1]; s = s.replace(ord[0], '').trim(); out.kind = 'order'; }
  else if (/Заказ\s*№/i.test(s)) { s = s.replace(/Заказ\s*№\s*/i, '').trim(); out.kind = 'order'; } // «ЗАКАЗ № Гулькевичи» — номера нет
  const paren = s.match(/\(([^)]*)\)\s*$/);
  if (paren) { out.note = paren[1].trim(); s = s.replace(paren[0], '').trim(); }
  s = s.replace(/^[,;\s]+|[,;\s]+$/g, '');
  if (!s) return out;
  if (ORG_RE.test(s) && !ADDR_RE.test(s)) { out.customerName = s; if (out.kind === 'unknown') out.kind = 'customer'; }
  else if (ADDR_RE.test(s)) { out.objectName = s; if (out.kind === 'unknown') out.kind = 'address'; }
  else out.objectName = s; // «СОШ2», «Мездах2» — как объект, на утверждение
  return out;
}

// ─── Описание и полнота ─────────────────────────────────────────────────────────────────────────────

const sentence = (s?: string) => { const t = cleanText(s); return !t ? '' : /[.!?]$/.test(t) ? t : `${t}.`; };

/** «<Наименование> (в дальнейшем именуемое «Изделие»), изготовленное из <материалы>. <Установка> <Назначение>» (ПС.5). */
export function buildDescription(p: { name?: string; materials?: string; installationMethod?: string; purpose?: string }): string {
  const name = cleanText(p.name).replace(/[.\s]+$/, '');
  if (!name) return '';
  const mat = cleanText(p.materials).replace(/^изготовлен\S*\s+из\s+/i, '');
  const head = `${name} (в дальнейшем именуемое «Изделие»)${mat ? `, изготовленное из ${sentence(mat)}` : '.'}`;
  return [head, sentence(p.installationMethod), sentence(p.purpose)].filter(Boolean).join(' ');
}

export interface PassportLike {
  passportNumber?: string; date?: Date | string | null; warrantyCode?: string; productCode?: string; name?: string;
  height?: number | null; length?: number | null; width?: number | null; weight?: number | null;
  materials?: string; installationMethod?: string; purpose?: string; description?: string; category?: string;
  supplierOrgId?: unknown; customerName?: string; objectName?: string; images?: Array<{ kind: string }>;
}

/** Чего не хватает до выдачи (подписи полей — для «Требуют заполнения» и проверки перед PDF). */
export function missingFields(p: PassportLike): string[] {
  const m: string[] = [];
  const empty = (v: unknown) => v === undefined || v === null || (typeof v === 'string' && !v.trim()) || (typeof v === 'number' && !Number.isFinite(v));
  if (empty(p.name)) m.push('Наименование');
  if (empty(p.category)) m.push('Категория');
  if (empty(p.date)) m.push('Дата');
  if (empty(p.supplierOrgId)) m.push('Поставщик');
  if (empty(p.height) || empty(p.length) || empty(p.width)) m.push('Габариты');
  if (empty(p.weight)) m.push('Вес');
  if (empty(p.materials)) m.push('Материалы');
  if (empty(p.installationMethod)) m.push('Установка');
  if (empty(p.purpose)) m.push('Назначение');
  if (empty(p.description)) m.push('Описание');
  if (empty(p.customerName) && empty(p.objectName)) m.push('Заказчик / объект');
  if (!(p.images || []).some((i) => i.kind === 'overview')) m.push('Общий вид');
  return m;
}

/**
 * Паспорт v2 (БЗ-6 Э4a2): что обязательно по категории — сверх общего списка `missingFields()`.
 * Поля — по категории (решение «по умолчанию», TASKS БЗ-6); рисунки — из справочника категорий (`requiredImages`,
 * по строке вид картинки; «(если разборное)» — только при isKit). Без категории — как v1.
 */
export const V2_REQUIRED_FIELDS: Record<string, Array<[string, string]>> = {
  DIO: [['ageFrom', 'Возраст от'], ['ageTo', 'Возраст до'], ['maxUsers', 'Пользователей одновременно'], ['fallHeight', 'Высота свободного падения'], ['siteLength', 'Площадка (длина)'], ['siteWidth', 'Площадка (ширина)'], ['serviceLifeYears', 'Срок службы']],
  DSP: [['ageFrom', 'Возраст от'], ['maxUsers', 'Пользователей одновременно'], ['siteLength', 'Площадка (длина)'], ['siteWidth', 'Площадка (ширина)'], ['serviceLifeYears', 'Срок службы']],
  TRN: [['heightMin', 'Рост пользователя от'], ['weightMax', 'Вес пользователя до'], ['maxUsers', 'Пользователей одновременно'], ['siteLength', 'Площадка (длина)'], ['siteWidth', 'Площадка (ширина)'], ['serviceLifeYears', 'Срок службы']],
  WRK: [['maxUsers', 'Пользователей одновременно'], ['siteLength', 'Площадка (длина)'], ['siteWidth', 'Площадка (ширина)'], ['serviceLifeYears', 'Срок службы']],
  MAF: [['serviceLifeYears', 'Срок службы']],
};
export const IMAGE_KIND_LABELS: Record<string, string> = {
  overview: 'Общий вид', dimensions: 'Габариты', safety: 'Зона безопасности', mounting: 'Монтаж', overview_callouts: 'Общий вид с выносками',
  nameplate: 'Табличка', safety_zone: 'Зона безопасности', foundation: 'Схема фундамента', holes: 'Схема скважин', assembly: 'Схема сборки', bom_item: 'Деталь комплектности',
};

export interface PassportV2Like extends PassportLike {
  passportCategory?: string; isKit?: boolean; elements?: unknown[]; installationTypeId?: unknown;
  [k: string]: unknown;
}

export function missingFieldsV2(p: PassportV2Like, cat?: { requiredImages?: string } | null): string[] {
  const m = missingFields(p);
  const code = String(p.passportCategory || '');
  if (!code) return m;
  const empty = (v: unknown) => v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length) || (typeof v === 'number' && !Number.isFinite(v));
  if (empty(p.elements) && code !== 'MAF') m.push('Элементы');
  if (empty(p.installationTypeId)) m.push('Способ установки');
  for (const [k, label] of V2_REQUIRED_FIELDS[code] ?? []) if (empty(p[k])) m.push(label);
  // «safety» (v1) и «safety_zone» (v2) — одно и то же требование
  const has = new Set((p.images || []).map((i) => (i.kind === 'safety' ? 'safety_zone' : i.kind)));
  for (const line of String(cat?.requiredImages ?? '').split(/\r?\n/)) {
    const kind = line.trim().split(/\s+/)[0];
    if (!kind || (/если разборн/i.test(line) && !p.isKit)) continue;
    const k = kind === 'safety' ? 'safety_zone' : kind;
    if (!has.has(k)) { const label = `Рисунок: ${IMAGE_KIND_LABELS[k] ?? k}`; if (!m.includes(label) && !(k === 'overview' && m.includes('Общий вид'))) m.push(label); }
  }
  return m;
}

/** Комплектность по умолчанию (Приложение 3). */
export const DEFAULT_BOM = [{ pos: 1, code: 'И-1', name: 'Изделие в сборе', qty: 1, unit: 'шт.' }];
