import { SUGGESTED_TYPOS, applyDict, cleanText, parseDecimal, parseRuDate, splitObject, warrantyCodeFor } from './passport-rules';
import { serialDate, type SheetData } from './xlsx-read';

/**
 * Перенос паспортов из таблицы «Pasports» (TASKS ПС.3) — логика без БД: строка листа «Данные» (+ «Фотографии»)
 * → документ паспорта, список изменений «поле · было · стало · причина» и вопросы «на решение пользователя».
 * Ничего не придумывает: пустое остаётся пустым (уйдёт в «Требуют заполнения»).
 */

export type ImageKind = 'overview' | 'dimensions' | 'safety' | 'mounting';
export interface Change { no: string; field: string; before: string; after: string; reason: string }
export interface Decision { no: string; topic: string; text: string }
export interface PlanItem { no: string; row: number; doc: Record<string, unknown>; images: Array<{ kind: ImageKind; media: string; caption?: string }>; objectRaw: string }
export interface OrgRef { id: string; name: string; shortName?: string }
export interface ImportCtx {
  /** утверждённый словарь опечаток (без него опечатки только перечисляются) */
  dict?: Record<string, string>;
  /** наши компании — для supplierOrgId */
  ourCompanies?: OrgRef[];
  /** единый список категорий: как в таблице → как правильно */
  categories?: Record<string, string>;
  /** решения по отдельным паспортам: { '549': { supplier: 'ООО «СпортИнЮг»' } } */
  overrides?: Record<string, Record<string, unknown>>;
  /** пустое (и категорию) — из паспортов той же модели (артикул + название) */
  fillFromModel?: boolean;
}

/** Поля модели: одинаковы у всех паспортов одного изделия. */
const MODEL_FIELDS = ['name', 'category', 'height', 'length', 'width', 'weight', 'materials', 'installationMethod', 'purpose', 'description'] as const;
const LABEL: Record<string, string> = { name: 'Наименование', category: 'Категория', height: 'Высота', length: 'Длина', width: 'Ширина', weight: 'Вес', materials: 'Материалы', installationMethod: 'Установка', purpose: 'Назначение', description: 'Описание', supplier: 'Поставщик' };

const HEAD = {
  no: 'Паспорт№', date: 'Дата', warranty: 'Гарантийный Талон', code: 'Номер Изделия', article: 'Артикул', name: 'Наименование', category: 'Категория',
  height: 'Высота', length: 'Длина', width: 'Ширина', weight: 'Вес', description: 'Описание', materials: 'Материалы', install: 'Установка', purpose: 'Назначение',
  object: 'Объект', supplier: 'Поставщик',
} as const;
/** «Фотографии»: D общий вид, E–G габариты 1–3, H зона безопасности, I–J монтаж 1–2 (по выгрузке 2026-10-21). */
const PHOTO_COLS: Array<[number, ImageKind, string?]> = [[4, 'dimensions', 'Вид 1'], [5, 'dimensions', 'Вид 2'], [6, 'dimensions', 'Вид 3'], [7, 'safety', 'Рисунок — Зона безопасности'], [8, 'mounting'], [9, 'mounting']];

const normKey = (s: string) => s.toLowerCase().replace(/ё/g, 'е').replace(/[«»"'.,()\s-]/g, '');
const ourKey = (s: string) => normKey(s.replace(/^(ООО|ИП|АО|ПАО|ЗАО)\s+/i, ''));
const intStr = (v: string | undefined) => { const n = Number(String(v ?? '').replace(',', '.')); return Number.isFinite(n) && String(v ?? '').trim() !== '' ? String(Math.round(n)) : ''; };

function headerMap(sheet: SheetData): Map<string, number> {
  const h = sheet.rows.get(1) ?? new Map();
  return new Map([...h].map(([c, v]) => [String(v).trim(), c]));
}

export function planImport(data: SheetData, photos: SheetData | undefined, ctx: ImportCtx = {}) {
  const head = headerMap(data);
  const col = (k: keyof typeof HEAD) => head.get(HEAD[k]);
  const missingHead = (Object.keys(HEAD) as Array<keyof typeof HEAD>).filter((k) => col(k) === undefined);
  if (missingHead.length) throw new Error(`В листе «Данные» нет колонок: ${missingHead.map((k) => HEAD[k]).join(', ')}`);
  const items: PlanItem[] = [];
  const changes: Change[] = [];
  const decisions: Decision[] = [];
  const typoSeen = new Map<string, string[]>();
  const dict = ctx.dict ?? {};

  // картинки общего вида: Данные!E (колонка «Фото_ОбщийВид_ID»)
  const overviewCol = head.get('Фото_ОбщийВид_ID');
  const overviewByRow = new Map(data.images.filter((i) => i.col === overviewCol).map((i) => [i.row, i.media]));
  // «Фотографии»: по № паспорта в колонке A
  const extraByNo = new Map<string, Array<{ kind: ImageKind; media: string; caption?: string }>>();
  if (photos) {
    for (const im of photos.images) {
      const kind = PHOTO_COLS.find(([c]) => c === im.col);
      if (!kind) continue;
      const no = intStr(photos.rows.get(im.row)?.get(0));
      if (!no) continue;
      const list = extraByNo.get(no) ?? [];
      list.push({ kind: kind[1], media: im.media, caption: kind[2] });
      extraByNo.set(no, list);
    }
  }
  const photoName = new Map<string, string>();
  if (photos) for (const [r, cells] of photos.rows) if (r > 1 && cells.get(2)) photoName.set(intStr(cells.get(0)), String(cells.get(2)));

  const rows = [...data.rows].filter(([r, cells]) => r > 1 && intStr(cells.get(col('no')!))).sort((a, b) => a[0] - b[0]);
  for (const [r, cells] of rows) {
    const get = (k: keyof typeof HEAD) => String(cells.get(col(k)!) ?? '');
    const no = intStr(get('no'));
    const doc: Record<string, unknown> = { passportNumber: no, passportNo: Number(no), source: 'sheet:Pasports', warrantyMonths: 12, bom: [{ pos: 1, code: 'И-1', name: 'Изделие в сборе', qty: 1, unit: 'шт.' }] };
    const ch = (field: string, before: unknown, after: unknown, reason: string) => { if (String(before ?? '') !== String(after ?? '')) changes.push({ no, field, before: String(before ?? ''), after: String(after ?? ''), reason }); };
    const text = (field: string, raw: string) => {
      let v = cleanText(raw);
      if (v !== raw) ch(field, raw, v, 'пробелы, кавычки, знаки препинания');
      for (const bad of Object.keys(SUGGESTED_TYPOS)) if (new RegExp(bad, 'i').test(v)) typoSeen.set(bad, [...(typoSeen.get(bad) ?? []), no]);
      const fixed = applyDict(v, dict);
      if (fixed !== v) { ch(field, v, fixed, 'опечатка (утверждённый словарь)'); v = fixed; }
      return v;
    };

    // дата: серийная (xlsx) или «ДД.ММ.ГГГГ» (Sheets API)
    const rawDate = get('date');
    const date = /^\d+(\.\d+)?$/.test(rawDate) ? serialDate(Number(rawDate)) : parseRuDate(rawDate);
    if (date) doc.date = date; else decisions.push({ no, topic: 'Дата', text: `не распознана: «${rawDate}»` });
    doc.warrantyCode = cleanText(get('warranty')) || undefined;
    if (date && doc.warrantyCode && doc.warrantyCode !== warrantyCodeFor(date, no)) decisions.push({ no, topic: 'Талон', text: `${doc.warrantyCode} не совпадает с правилом (${warrantyCodeFor(date, no)}) — оставлен как выдан` });
    doc.productCode = intStr(get('code')) || undefined;
    doc.article = cleanText(get('article')) || undefined;
    doc.name = text('Наименование', get('name')) || undefined;
    if (!doc.name && photoName.get(no)) { doc.name = text('Наименование', photoName.get(no)!); ch('Наименование', '', doc.name, 'пусто в «Данные» — взято из листа «Фотографии»'); }
    doc.category = cleanText(get('category')) || undefined;
    for (const [k, f] of [['height', 'height'], ['length', 'length'], ['width', 'width'], ['weight', 'weight']] as const) {
      const raw = get(k);
      const n = parseDecimal(raw);
      if (n === undefined) continue;
      if (Number.isNaN(n)) { decisions.push({ no, topic: 'Число', text: `${HEAD[k]}: «${raw}» — не число, не перенесено` }); continue; }
      doc[f] = n;
      if (/,/.test(raw)) ch(HEAD[k], raw, n, 'десятичная запятая → число');
    }
    let description = text('Описание', get('description'));
    let materials = text('Материалы', get('materials'));
    let install = text('Установка', get('install'));
    let purpose = text('Назначение', get('purpose'));
    let object = get('object');
    const supplier = cleanText(get('supplier'));
    // сдвиг колонок (аудит §3.2, №549): «Назначение» в «Объекте», «Установка» в «Назначении», «Материалы» в «Установке»
    if (/^Предназначен/i.test(cleanText(object)) && /^Изделие\s+устанавлива/i.test(purpose) && !/^Изделие\s+устанавлива/i.test(install)) {
      const was = { materials, install, purpose, object };
      const descShift = materials && !/^(стал|профил|кругл|лист|труб|металл|нержав|сталь)/i.test(materials) && materials.length > 30;
      if (descShift) description = materials; // в «Материалах» — второе описание
      materials = install; install = purpose; purpose = cleanText(object); object = '';
      ch('Материалы', was.materials, materials, 'сдвиг колонок восстановлен'); ch('Установка', was.install, install, 'сдвиг колонок восстановлен');
      ch('Назначение', was.purpose, purpose, 'сдвиг колонок восстановлен'); ch('Объект', was.object, '', 'сдвиг колонок восстановлен (было «Назначение»)');
      decisions.push({ no, topic: 'Сдвиг колонок', text: 'колонки «Материалы → Объект» сдвинуты на одну вправо — восстановлено (проверьте)' });
    }
    if (!materials && !install && !purpose && !object && !supplier) decisions.push({ no, topic: 'Обрезанная строка', text: 'нет материалов, установки, назначения, объекта и поставщика — не придумываем; можно взять у паспорта той же модели (артикул ' + (doc.article || '—') + ')' });
    doc.description = description || undefined;
    doc.materials = materials || undefined;
    doc.installationMethod = install || undefined;
    doc.purpose = purpose || undefined;
    // «Объект» → заказчик / № заказа / адрес (текст; связи с контрагентами и заказами — после утверждения)
    const parts = splitObject(object);
    if (parts.customerName) doc.customerName = parts.customerName;
    if (parts.orderNo) doc.orderNo = parts.orderNo;
    if (parts.objectName) doc.objectName = parts.objectName;
    // поставщик: наша компания → supplierOrgId; сторонний (ИП Боев, ИП Харитонова) — только текст
    doc.supplier = supplier || undefined;
    if (supplier) {
      const k = ourKey(supplier);
      const org = (ctx.ourCompanies ?? []).find((o) => [o.name, o.shortName].filter(Boolean).some((n) => ourKey(String(n)) === k || ourKey(String(n)).startsWith(k) || k.startsWith(ourKey(String(n)))));
      if (org) doc.supplierOrgId = org.id;
      else if (/^ИП\s/i.test(supplier)) decisions.push({ no, topic: 'Поставщик', text: `«${supplier}» — сторонний поставщик (решение 2026-10-21): реквизиты и печать в PDF — нет, только название` });
      else decisions.push({ no, topic: 'Поставщик', text: `«${supplier}» не найден среди наших компаний — заведите/сопоставьте` });
    }
    const imgs: PlanItem['images'] = [];
    const ov = overviewByRow.get(r);
    if (ov) imgs.push({ kind: 'overview', media: ov });
    imgs.push(...(extraByNo.get(no) ?? []));
    // убрать пустое
    for (const k of Object.keys(doc)) if (doc[k] === undefined) delete doc[k];
    items.push({ no, row: r, doc, images: imgs, objectRaw: cleanText(object) });
  }

  // решения пользователя по отдельным паспортам
  for (const it of items) for (const [f, v] of Object.entries(ctx.overrides?.[it.no] ?? {})) {
    if (String(it.doc[f] ?? '') === String(v)) continue;
    changes.push({ no: it.no, field: LABEL[f] ?? f, before: String(it.doc[f] ?? ''), after: String(v), reason: 'решение пользователя' });
    it.doc[f] = v;
    if (f === 'supplier') { const org = (ctx.ourCompanies ?? []).find((o) => [o.name, o.shortName].filter(Boolean).some((n) => ourKey(String(n)) === ourKey(String(v)))); if (org) it.doc.supplierOrgId = org.id; }
  }
  // единый список категорий
  if (ctx.categories) for (const it of items) {
    const c = it.doc.category as string | undefined;
    if (!c) continue;
    const to = ctx.categories[c];
    if (!to) { decisions.push({ no: it.no, topic: 'Категория', text: `«${c}» нет в общем списке категорий` }); continue; }
    if (to !== c) { changes.push({ no: it.no, field: 'Категория', before: c, after: to, reason: 'единый список категорий' }); it.doc.category = to; }
  }
  // модели: пустое и категория — из паспортов той же модели (решение 2026-10-21: модели одинаковые, ошибки заполнения)
  if (ctx.fillFromModel) {
    const descEmpty = (d: Record<string, unknown>) => !d.description || normKey(String(d.description)) === normKey(String(d.name ?? '')); // «описание» = только название
    const groups = new Map<string, PlanItem[]>();
    for (const it of items) {
      // модель = артикул + название (у «2_1» две разные стойки); без названия модель не определить
      const k = it.doc.name ? `${normKey(String(it.doc.article ?? ''))}|${normKey(String(it.doc.name))}` : '';
      if (k) groups.set(k, [...(groups.get(k) ?? []), it]);
    }
    for (const g of groups.values()) {
      if (g.length < 2) continue;
      for (const f of MODEL_FIELDS) {
        const has = (d: Record<string, unknown>) => (f === 'description' ? !descEmpty(d) : d[f] !== undefined && d[f] !== '');
        const votes = new Map<string, { v: unknown; nos: string[] }>();
        for (const it of g) if (has(it.doc)) { const k = JSON.stringify(it.doc[f]); const e = votes.get(k) ?? { v: it.doc[f], nos: [] }; e.nos.push(it.no); votes.set(k, e); }
        if (!votes.size) continue;
        const best = [...votes.values()].sort((a, b) => b.nos.length - a.nos.length)[0];
        for (const it of g) {
          if (!has(it.doc)) { changes.push({ no: it.no, field: LABEL[f], before: String(it.doc[f] ?? ''), after: String(best.v), reason: `пусто — из паспорта той же модели №${best.nos[0]}` }); it.doc[f] = best.v; }
          else if (f === 'category' && JSON.stringify(it.doc[f]) !== JSON.stringify(best.v)) { changes.push({ no: it.no, field: LABEL[f], before: String(it.doc[f]), after: String(best.v), reason: `одна категория у модели (как у №${best.nos.join(', ')})` }); it.doc[f] = best.v; }
        }
      }
    }
    // «Обрезанная строка» решена, если модель всё заполнила
    for (let i = decisions.length - 1; i >= 0; i--) {
      const d = decisions[i];
      if (d.topic !== 'Обрезанная строка') continue;
      const it = items.find((x) => x.no === d.no);
      if (it?.doc.materials && it.doc.installationMethod && it.doc.purpose) decisions.splice(i, 1, { no: d.no, topic: 'Заполнено по модели', text: 'материалы, установка, назначение — из паспорта той же модели; объект и поставщик — пусто' });
    }
  }

  // по всей таблице: дубли номера изделия, даты не по порядку, разные категории у одного названия
  const byCode = new Map<string, string[]>();
  for (const it of items) if (it.doc.productCode) byCode.set(String(it.doc.productCode), [...(byCode.get(String(it.doc.productCode)) ?? []), it.no]);
  for (const [code, nos] of byCode) if (nos.length > 1) {
    for (const it of items) if (nos.includes(it.no)) it.doc.productCodeDuplicate = true;
    decisions.push({ no: nos.join(', '), topic: 'Дубль номера изделия', text: `${code} у паспортов ${nos.join(', ')} — оставлен, помечен «дубль» (решение 2026-10-21)` });
  }
  for (const it of items) if (!it.doc.productCodeDuplicate) it.doc.productCodeDuplicate = false;
  for (let i = 1; i < items.length; i++) {
    const a = items[i - 1].doc.date as Date | undefined, b = items[i].doc.date as Date | undefined;
    if (a && b && b < a) decisions.push({ no: items[i].no, topic: 'Дата не по порядку', text: `${b.toISOString().slice(0, 10)} раньше, чем у №${items[i - 1].no} (${a.toISOString().slice(0, 10)}) — оставлена` });
  }
  const cats = new Map<string, Map<string, string[]>>();
  for (const it of items) {
    if (!it.doc.name || !it.doc.category) continue;
    const k = normKey(String(it.doc.name));
    const m = cats.get(k) ?? new Map<string, string[]>();
    m.set(String(it.doc.category), [...(m.get(String(it.doc.category)) ?? []), it.no]);
    cats.set(k, m);
  }
  for (const m of cats.values()) if (m.size > 1) {
    const nos = [...m.values()].flat();
    const name = String(items.find((x) => x.no === nos[0])?.doc.name);
    decisions.push({ no: nos.join(', '), topic: 'Категория', text: `«${name}»: ${[...m].map(([c, n]) => `${c} (${n.join(', ')})`).join(' / ')}` });
  }
  for (const it of items) for (const [f, lbl] of [['category', 'Категория'], ['name', 'Наименование']] as const) if (!it.doc[f]) decisions.push({ no: it.no, topic: 'Пусто', text: `${lbl} — пусто, в «Требуют заполнения»` });
  for (const [bad, nos] of typoSeen) if (!dict[bad]) decisions.push({ no: [...new Set(nos)].join(', '), topic: 'Опечатка', text: `«${bad}» → «${SUGGESTED_TYPOS[bad]}»? (исправлю только после утверждения словаря)` });

  // «Объект»: таблица разноса на утверждение — по уникальным значениям
  const objects = new Map<string, { parts: ReturnType<typeof splitObject>; nos: string[] }>();
  for (const it of items) if (it.objectRaw) { const o = objects.get(it.objectRaw) ?? { parts: splitObject(it.objectRaw), nos: [] }; o.nos.push(it.no); objects.set(it.objectRaw, o); }
  return { items, changes, decisions, objects: [...objects].map(([raw, o]) => ({ raw, ...o.parts, count: o.nos.length, nos: o.nos })) };
}
