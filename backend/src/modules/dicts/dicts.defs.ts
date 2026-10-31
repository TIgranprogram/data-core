import type { mongo } from 'mongoose';
import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import { sameRe } from '../../common/text/same-text';
import { normSize } from '../../common/catalog/materials-text';
import { personWorkTypeIds, workTypeFields } from '../../common/catalog/person-work-types';
import { passportPhrasesDef } from './dicts.passport-phrases';
import { productGroupDefs } from './dicts.product-groups';
import { DICT_META } from './dicts.meta';
type Db = mongo.Db;
type Document = mongo.Document;
type ObjectId = mongo.ObjectId;

/**
 * Описание справочников раздела «Справочники» (TASKS СП.4–СП.8). Каждый справочник — поверх уже существующей
 * коллекции общей базы (units, categories, color_references, persons, worktypes) или простых списков data-core
 * (`dict_values`: графики выплат, типы счетов, услуги). Новых таблиц-дублей нет.
 *
 * У справочника: как читать (`coll` + `match`), как назвать строку, какие поля правятся, где значение используется
 * (счётчик «используется в N» и раскрытие строки), как перевести связанное при объединении дублей.
 */
export type Doc = Document & { _id: ObjectId };
/** photo — одна картинка (id фото строкой), photos — несколько (список id); в приложении — загрузка, а не ввод id (БЗ-6 Э9.7). */
export type Field = { key: string; label: string; type?: 'text' | 'textarea' | 'select' | 'money' | 'color' | 'photo' | 'photos' | 'date'; required?: boolean; options?: { value: string; label: string }[];
  /** Строка — ключ в `refs` для select (id записи); объект — выбор кодов из записей справочника `dict` (у двух — через запятую), хранится строка кодов через запятую. */
  ref?: string | { dict: string; multiple?: boolean };
  hint?: string; wide?: boolean;
  /** Флажок «да / нет» (select с вариантом «да»): в базе — true, иначе null. */
  bool?: boolean;
  /** Служебное (коды и настройка): не столбец таблицы; в карточке — внизу, в блоке «Для настройки (менять редко)». */
  tech?: boolean;
  /** Код не меняется после создания (на него ссылаются тексты и изделия). */
  lockAfterCreate?: boolean };
/** more — дополнительные блоки «связанного» (у сотрудника: заявки + что выдано со склада). */
export type Related = { title: string; items: { label: string; sub?: string; href?: string }[]; total: number; more?: Related[] };

export interface DictDef {
  key: string;
  group: string;
  title: string;
  /** Что это и где используется — подсказка над таблицей. */
  hint: string;
  coll: string;
  match: Document;
  /** Колонки таблицы (кроме названия и «используется»). */
  columns: { key: string; label: string }[];
  fields: Field[];
  name(d: Doc): string;
  /** Плоская строка для таблицы и формы. */
  row(d: Doc): Record<string, unknown>;
  /** Документ для записи из тела запроса (только разрешённые поля). */
  toDoc(body: Record<string, unknown>, isNew: boolean, db: Db, id?: string): Promise<Document>;
  /** Проверка перед «в корзину» (бросает ошибку по-русски): например, у узла дерева есть варианты. */
  beforeRemove?(db: Db, d: Doc): Promise<void>;
  /** Сколько раз используется каждое значение (id → N). */
  usage(db: Db, docs: Doc[]): Promise<Map<string, number>>;
  related(db: Db, d: Doc): Promise<Related>;
  /** Перевести всё связанное с `from` на `to` (объединение дублей). Возвращает число изменённых записей. */
  reassign(db: Db, from: Doc, to: Doc): Promise<number>;
  /** Значения, которые встречаются в данных / списках таблицы, но ещё не в справочнике (СП.6). */
  candidates?(db: Db): Promise<{ name: string; uses: number; source: string }[]>;
  /** Создать запись из одного названия (перенос). */
  fromName?(name: string, db: Db): Promise<Document>;
  /** Значения для выпадающего списка (`/supply/lookups`). */
  options?(docs: Doc[]): string[];
  /** Мягкое удаление: какие поля ставить (по умолчанию deletedAt). */
  softDelete?: Document;
  /** Кто правит (роль и старше); по умолчанию — менеджер и старше. «Паспорта» — директор (и админ). */
  editRoles?: string[];
  /** Ключ дубля (по умолчанию — название): у «Сортамента» размер повторяется у разных материалов. */
  dupKey?(d: Doc): string;
  /** Разделы приложения, где применяется справочник (русские названия) — подпись «Применяется в: …». */
  sections: string[];
  /** Как значение лежит в данных: 'name' — строкой (переименование идёт каскадом), 'id' — ссылкой по id/коду (каскад запрещён). */
  refBy: 'name' | 'id';
  /** Связь с данными не ведётся (услуги, оформление): удаление свободно. */
  untracked?: true;
  /** Причина запрета удаления (встроено в программу); null — можно. */
  locked?(d: Doc): string | null;
  /** Занято ли значение — быстрая проверка без подсчёта (по умолчанию: `usage` для одной записи). */
  busy?(db: Db, d: Doc): Promise<boolean>;
  /** Что считать сменой названия для каскада (по умолчанию — `name`): у сотрудника — только имя и фамилия, не телефон и должность. */
  renameKey?(d: Doc): string;
}
/** Описание без паспорта справочника (`sections`, `refBy` …) — их добавляет `DICT_META` в конце файла. */
export type DictBase = Omit<DictDef, 'sections' | 'refBy' | 'untracked' | 'locked'>;

const s = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();
const opt = (v: unknown) => s(v) || null;
/** Значение поля из тела запроса по типу: картинки — только валидные id фото. */
const isOid = (v: unknown) => Types.ObjectId.isValid(String(v ?? '')) && String(v).length === 24;
/** Поле-флажок справочника: «да» — true в базе (fieldValue), пусто — null. */
/** Служебное поле справочника (tech): не столбец таблицы, в карточке внизу. */
const TECH = (f: Field): Field => ({ ...f, tech: true });
const YES_NO = (key: string, label: string, hint: string): Field => ({ key, label, hint, type: 'select', bool: true, options: [{ value: 'true', label: 'да' }] });
const fieldValue = (f: Field, v: unknown) => {
  if (f.bool) return v === true || v === 'true' ? true : null;
  if (f.type === 'photos') return (Array.isArray(v) ? v : []).map(String).filter(isOid);
  if (f.type === 'photo') { const x = Array.isArray(v) ? v[0] : v; return isOid(x) ? String(x) : null; }
  return opt(v);
};
const oidOrNull = (v: unknown) => (v && Types.ObjectId.isValid(String(v)) ? new Types.ObjectId(String(v)) : null);
const count = async (db: Db, coll: string, q: Document) => db.collection(coll).countDocuments({ deletedAt: null, ...q });
/** Сколько раз встречается каждое строковое значение поля (нормализовано). */
// $unwind: у поля-массива (materials.colors) каждое значение считается отдельно; у строки — как было
async function tally(db: Db, coll: string, field: string, extra: Document = {}) {
  const rows = await db.collection(coll).aggregate([{ $match: { deletedAt: null, ...extra, [field]: { $nin: [null, ''] } } }, { $unwind: '$' + field }, { $match: { [field]: { $nin: [null, ''] } } }, { $group: { _id: '$' + field, n: { $sum: 1 } } }]).toArray();
  const m = new Map<string, number>();
  for (const r of rows) { const k = norm(r._id); m.set(k, (m.get(k) ?? 0) + (r.n as number)); }
  return m;
}
export const norm = (v: unknown) => s(v).toLowerCase().replace(/ё/g, 'е').replace(/[«»"'.]/g, '');
async function sheetList(db: Db, key: string): Promise<string[]> {
  const st = await db.collection('settings').findOne({ key: 'supply.sheetLists' });
  return ((st?.value as Record<string, string[] | undefined> | undefined)?.[key] ?? []).map(s).filter(Boolean);
}
/** Кандидаты: значения из данных и списков таблицы, которых нет среди названий/синонимов справочника. */
async function missing(known: string[], found: Map<string, { name: string; uses: number; source: string }>) {
  const k = new Set(known.map(norm));
  return [...found.values()].filter((x) => !k.has(norm(x.name))).sort((a, b) => b.uses - a.uses || a.name.localeCompare(b.name, 'ru'));
}
function add(found: Map<string, { name: string; uses: number; source: string }>, name: string, uses: number, source: string) {
  const n = norm(name); if (!n) return;
  const cur = found.get(n);
  if (cur) { cur.uses += uses; if (!cur.source.includes(source)) cur.source += ', ' + source; } else found.set(n, { name: s(name), uses, source });
}
export const translit = (t: string) => t.toLowerCase().replace(/[а-яё]/g, (c) => ({ а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya' } as Record<string, string>)[c] ?? '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const personName = (d: Doc) => [d.lastName, d.firstName, d.patronymic].map(s).filter(Boolean).join(' ');
/** «Кто подал» в заявках пишется «Имя Фамилия» — считаем оба порядка. */
const personKeys = (d: Doc) => [norm(`${s(d.firstName)} ${s(d.lastName)}`), norm(`${s(d.lastName)} ${s(d.firstName)}`), norm(d.firstName)].filter(Boolean);

/** «Нормативы»: name — короткое обозначение, title — полное наименование (в карточке); столбцы таблицы — статус и «Проверено». */
const standardsView = (d: DictBase): DictBase => ({
  ...d,
  columns: d.columns.filter((c) => c.key === 'status' || c.key === 'checkedAt'),
  fields: d.fields.map((f) => (f.key === 'name' ? { ...f, label: 'Обозначение (коротко)', hint: 'Как в тексте паспорта: «ГОСТ Р 57538-2017»' } : f)),
});

/** Простые списки data-core: { dict, name, notes, days?, … } */
function simpleList(key: string, group: string, title: string, hint: string, extra: Field[], usage?: { coll: string; field: string }, defaults: string[] = [], sheetKey?: string): DictBase {
  return {
    key, group, title, hint, coll: 'dict_values', match: { dict: key, deletedAt: null },
    columns: extra.filter((f) => !f.tech).map((f) => ({ key: f.key, label: f.label })),
    fields: [{ key: 'name', label: 'Название', required: true, wide: true }, ...extra],
    name: (d) => s(d.name),
    row: (d) => ({ name: s(d.name), ...Object.fromEntries(extra.map((f) => [f.key, d[f.key] ?? ''])) }),
    toDoc: async (b, isNew) => ({ ...(isNew ? { dict: key, deletedAt: null, createdAt: new Date() } : {}), name: s(b.name), ...Object.fromEntries(extra.map((f) => [f.key, fieldValue(f, b[f.key])])), updatedAt: new Date() }),
    usage: async (db, docs) => {
      if (!usage) return new Map();
      const t = await tally(db, usage.coll, usage.field);
      return new Map(docs.map((d) => [String(d._id), t.get(norm(d.name)) ?? 0]));
    },
    busy: usage ? async (db, d) => (await db.collection(usage.coll).countDocuments({ deletedAt: null, [usage.field]: sameRe(d.name) }, { limit: 1 })) > 0 : undefined,
    related: async (db, d) => {
      if (!usage) return { title: '', items: [], total: 0 };
      const q = { deletedAt: null, [usage.field]: new RegExp(`^\\s*${s(d.name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i') };
      const [rows, total] = await Promise.all([db.collection(usage.coll).find(q).sort({ _id: -1 }).limit(15).project({ num: 1, title: 1, requestDate: 1 }).toArray(), db.collection(usage.coll).countDocuments(q)]);
      return { title: 'Заявки', total, items: rows.map((r) => ({ label: `№${r.num ?? ''} ${s(r.title)}`, href: '#requests?open=' + String(r._id) })) };
    },
    reassign: async (db, from, to) => {
      if (!usage) return 0;
      const re = new RegExp(`^\\s*${s(from.name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i');
      return (await db.collection(usage.coll).updateMany({ [usage.field]: re }, { $set: { [usage.field]: s(to.name), ...(usage.coll === 'supplyrequests' ? { editedInApp: true } : {}) } })).modifiedCount;
    },
    candidates: async (db) => {
      const found = new Map<string, { name: string; uses: number; source: string }>();
      for (const v of defaults) add(found, v, 0, 'обычные');
      if (sheetKey) for (const v of await sheetList(db, sheetKey)) add(found, v, 0, 'Google-таблица');
      if (usage) for (const [k, n] of await tally(db, usage.coll, usage.field)) add(found, k, n, 'заявки');
      const docs = await db.collection('dict_values').find({ dict: key, deletedAt: null }).toArray();
      // в tally ключи нормализованы — берём красивое написание из списка, если есть
      return missing(docs.map((d) => s(d.name)), found);
    },
    fromName: async (name) => ({ dict: key, name: s(name), deletedAt: null, createdAt: new Date(), updatedAt: new Date() }),
    options: (docs) => docs.map((d) => s(d.name)),
  };
}

/**
 * «Серии изделий» (ИЗ-18): `products.series` хранит название строкой; серия изделия выбирается только из справочника.
 * «Используется» — число изделий; переименование и объединение правят `products.series` (поле только data-core, CRM его не читает).
 */
function productSeriesList(): DictBase {
  const base = simpleList('productSeries', 'Продукция', 'Серии изделий', 'Серия изделия: выбирается в форме изделия только из этого списка. Новую серию заводят здесь.', [], { coll: 'products', field: 'series' });
  const re = (name: unknown) => new RegExp(`^\\s*${s(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i');
  return {
    ...base,
    related: async (db, d) => {
      const q = { deletedAt: null, series: re(d.name) };
      const [rows, total] = await Promise.all([db.collection('products').find(q).sort({ _id: -1 }).limit(15).project({ sku: 1, name: 1 }).toArray(), db.collection('products').countDocuments(q)]);
      return { title: 'Изделия', total, items: rows.map((r) => ({ label: `${s(r.sku)} ${s(r.name)}`.trim(), href: '#products?open=' + String(r._id) })) };
    },
    reassign: async (db, from, to) => (await db.collection('products').updateMany({ series: re(from.name) }, { $set: { series: s(to.name), updatedAt: new Date() } })).modifiedCount,
    candidates: async (db) => {
      const found = new Map<string, { name: string; uses: number; source: string }>();
      for (const [k, n] of await tally(db, 'products', 'series')) add(found, k, n, 'изделия');
      const docs = await db.collection('dict_values').find({ dict: 'productSeries', deletedAt: null }).toArray();
      return missing(docs.map((d) => s(d.name)), found);
    },
  };
}

/**
 * Справочники металла склада: значение в позиции (`materials.<field>`) остаётся строкой, справочник даёт список для выбора и фильтров.
 * «Используется» — число позиций; материалы общие с CRM, поэтому при объединении только правим строку (без пометок приложения).
 */
function metalList(key: string, title: string, hint: string, field: 'assortment' | 'materialGrade'): DictBase {
  const rx = sameRe;
  return {
    ...simpleList(key, 'Склад и позиции', title, hint, [], { coll: 'materials', field }),
    related: async (db, d) => {
      const q = { deletedAt: null, [field]: rx(d.name) };
      const [rows, total] = await Promise.all([db.collection('materials').find(q).sort({ _id: -1 }).limit(15).project({ name: 1 }).toArray(), db.collection('materials').countDocuments(q)]);
      return { title: 'Позиции склада', total, items: rows.map((r) => ({ label: s(r.name), href: '#stock?open=' + String(r._id) })) };
    },
    reassign: async (db, from, to) => (await db.collection('materials').updateMany({ [field]: rx(from.name) }, { $set: { [field]: s(to.name), updatedAt: new Date() } })).modifiedCount,
    candidates: async (db) => {
      const found = new Map<string, { name: string; uses: number; source: string }>();
      for (const [k, n] of await tally(db, 'materials', field)) add(found, k, n, 'склад');
      const docs = await db.collection('dict_values').find({ dict: key, deletedAt: null }).toArray();
      return missing(docs.map((d) => s(d.name)), found);
    },
  };
}

/**
 * «Формы оплаты» (SPR-2): значение в позиции заказа (`incomes.paymentForm`) остаётся строкой, справочник даёт список для выбора.
 * Доходы общие с CRM: при объединении правим только строку; позиции показываем со ссылкой на заказ.
 */
const PAYMENT_FORMS = ['б/р', 'б/р 30%', 'б/р 50%', 'нал'];
function paymentFormsList(): DictBase {
  const base = simpleList('paymentForms', 'Заявки и счета', 'Формы оплаты',
    'б/р, б/р 30 %, нал — как в позициях заказов; от неё считается прогноз денег. Выбирается в заказе из списка — одно написание.', [],
    { coll: 'incomes', field: 'paymentForm' }, PAYMENT_FORMS);
  return {
    ...base,
    related: async (db, d) => {
      const q = { deletedAt: null, paymentForm: sameRe(d.name) };
      const [rows, total] = await Promise.all([db.collection('incomes').find(q).sort({ _id: -1 }).limit(15).project({ orderNo: 1, title: 1, orderId: 1 }).toArray(), db.collection('incomes').countDocuments(q)]);
      return { title: 'Позиции заказов', total, items: rows.map((r) => ({ label: `${s(r.orderNo)} ${s(r.title)}`.trim(), href: '#orders?open=' + String(r.orderId ?? r._id) })) };
    },
    // шапка заказа — истина, строки — её кэш: меняем обе, иначе деньги и заказ расходятся
    reassign: async (db, from, to) => {
      await db.collection('salesorders').updateMany({ paymentForm: sameRe(from.name) }, { $set: { paymentForm: s(to.name), editedInApp: true, updatedAt: new Date() } });
      return (await db.collection('incomes').updateMany({ paymentForm: sameRe(from.name) }, { $set: { paymentForm: s(to.name), updatedAt: new Date() } })).modifiedCount;
    },
    candidates: async (db) => {
      const found = new Map<string, { name: string; uses: number; source: string }>();
      for (const v of PAYMENT_FORMS) add(found, v, 0, 'обычные');
      for (const [k, n] of await tally(db, 'incomes', 'paymentForm')) add(found, k, n, 'заказы');
      const docs = await db.collection('dict_values').find({ dict: 'paymentForms', deletedAt: null }).toArray();
      return missing(docs.map((d) => s(d.name)), found);
    },
  };
}

/**
 * «Паспорта» (БЗ-6): где используется запись — паспорта (по коду категории или по id записи) и другие справочники
 * группы, которые ссылаются на её код списком через запятую. Без этого «Используется: —» и удаление нужного.
 */
type PpRef = { pp?: 'passportCategory' | 'elements' | 'materialIds' | 'installationTypeId'; dicts?: { dict: string; field: string; title: string }[] };
export const codeList = (v: unknown) => s(v).split(/[,;\n]/).map(s).filter(Boolean);
function ppUsage(ref: PpRef): Pick<DictDef, 'usage' | 'related' | 'reassign'> {
  // ALL («Для всех») — его тексты получают все паспорта с категорией
  const ppQuery = (d: Doc): Document | null => {
    if (!ref.pp) return null;
    if (ref.pp !== 'passportCategory') return { deletedAt: null, [ref.pp]: d._id };
    const code = s(d.code);
    return code === 'ALL' ? { deletedAt: null, passportCategory: { $nin: [null, ''] } } : code ? { deletedAt: null, passportCategory: code } : null;
  };
  const refRows = async (db: Db, d: Doc) => {
    const code = s(d.code);
    if (!code || !ref.dicts?.length) return [];
    const out: { row: Doc; dict: string; field: string; title: string }[] = [];
    for (const r of ref.dicts) for (const row of (await db.collection('dict_values').find({ dict: r.dict, deletedAt: null }).toArray()) as Doc[]) if (codeList(row[r.field]).includes(code)) out.push({ row, ...r });
    return out;
  };
  return {
    usage: async (db, docs) => new Map(await Promise.all(docs.map(async (d) => {
      const q = ppQuery(d);
      return [String(d._id), (q ? await db.collection('productpassports').countDocuments(q) : 0) + (await refRows(db, d)).length] as [string, number];
    }))),
    related: async (db, d) => {
      const q = ppQuery(d);
      const [pp, total, refs] = await Promise.all([
        q ? db.collection('productpassports').find(q).sort({ _id: -1 }).limit(15).project({ passportNumber: 1, name: 1, customerName: 1 }).toArray() : [],
        q ? db.collection('productpassports').countDocuments(q) : 0,
        refRows(db, d)]);
      return {
        title: ref.pp ? 'Паспорта и справочники' : 'Справочники', total: total + refs.length,
        items: [
          ...refs.map((x) => ({ label: `${x.title}: ${s(x.row.name)}`, sub: s(x.row.code), href: `#dicts?d=${x.dict}&of=dict&open=${String(x.row._id)}` })),
          ...pp.map((p) => ({ label: `Паспорт № ${s(p.passportNumber)} ${s(p.name)}`, sub: s(p.customerName), href: '#passports?of=passports&open=' + String(p._id) })),
        ],
      };
    },
    // объединение: паспорта и ссылки по коду переходят к записи, с которой объединяют
    reassign: async (db, from, to) => {
      // та же запись: pull-after-push стёр бы ссылки — переносить нечего
      if (String(from._id) === String(to._id)) return 0;
      let n = 0;
      if (ref.pp === 'passportCategory') {
        if (s(from.code) && s(to.code)) n += (await db.collection('productpassports').updateMany({ passportCategory: s(from.code) }, { $set: { passportCategory: s(to.code) } })).modifiedCount;
      } else if (ref.pp === 'installationTypeId') {
        n += (await db.collection('productpassports').updateMany({ installationTypeId: from._id }, { $set: { installationTypeId: to._id } })).modifiedCount;
      } else if (ref.pp) {
        const f = ref.pp;
        await db.collection('productpassports').updateMany({ $and: [{ [f]: from._id }, { [f]: { $ne: to._id } }] },{ $push: { [f]: to._id } } as Document);
        n += (await db.collection('productpassports').updateMany({ [f]: from._id }, { $pull: { [f]: from._id } } as Document)).modifiedCount;
      }
      if (s(from.code) && s(to.code)) for (const x of await refRows(db, from)) {
        const v = [...new Set(codeList(x.row[x.field]).map((c) => (c === s(from.code) ? s(to.code) : c)))].join(', ');
        n += (await db.collection('dict_values').updateOne({ _id: x.row._id }, { $set: { [x.field]: v, updatedAt: new Date() } })).modifiedCount;
      }
      return n;
    },
  };
}

/**
 * МИ: «где используется» ещё и в изделиях — `products.materialsSpec` (материалы изделия таблицей). `q` — условие на
 * изделия для записи (null — нет), `move` — перевести изделия с `from` на `to` при объединении.
 */
type UsageParts = Pick<DictDef, 'usage' | 'related' | 'reassign'>;
function withProducts(base: UsageParts, q: (db: Db, d: Doc) => Promise<Document | null>, move: (db: Db, from: Doc, to: Doc) => Promise<number>): UsageParts {
  const prodQ = async (db: Db, d: Doc) => { const x = await q(db, d); return x ? { deletedAt: null, ...x } : null; };
  return {
    usage: async (db, docs) => {
      const m = await base.usage(db, docs);
      for (const d of docs) { const x = await prodQ(db, d); if (x) m.set(String(d._id), (m.get(String(d._id)) ?? 0) + (await db.collection('products').countDocuments(x))); }
      return m;
    },
    related: async (db, d) => {
      const r = await base.related(db, d);
      const x = await prodQ(db, d);
      if (!x) return r;
      const [rows, total] = await Promise.all([db.collection('products').find(x).sort({ _id: -1 }).limit(15).project({ name: 1, sku: 1 }).toArray(), db.collection('products').countDocuments(x)]);
      return { title: r.total ? `${r.title}, изделия` : 'Изделия', total: r.total + total,
        items: [...r.items, ...rows.map((p) => ({ label: `Изделие ${s(p.name)}`, sub: s(p.sku), href: '#products?open=' + String(p._id) }))] };
    },
    reassign: async (db, from, to) => (await base.reassign(db, from, to)) + (await move(db, from, to)),
  };
}
const noUsage: UsageParts = { usage: async () => new Map(), related: async () => ({ title: '', items: [], total: 0 }), reassign: async () => 0 };
/** id записей «Материалов и покрытий» с кодом («Сортамент» привязан к коду материала, таблица изделия — к id). */
const matIdsByCode = async (db: Db, code: string) => (code ? (await db.collection('dict_values').find({ dict: 'passportMaterials', code }).project({ _id: 1 }).toArray()).map((x) => x._id) : []);

const BASE: DictBase[] = [
  // ───────── Склад и позиции ─────────
  {
    key: 'categories', group: 'Склад и позиции', title: 'Категории',
    hint: 'Категории позиций склада и заявок: «Категория → Позиция» в формах, плитки и фильтры «Остатков».',
    coll: 'categories', match: { type: 'material', deletedAt: null },
    columns: [{ key: 'description', label: 'Описание' }],
    fields: [{ key: 'name', label: 'Название', required: true, wide: true }, { key: 'description', label: 'Описание', type: 'textarea', wide: true }],
    name: (d) => s(d.name),
    row: (d) => ({ name: s(d.name), description: s(d.description) }),
    toDoc: async (b, isNew, db) => {
      const name = s(b.name);
      if (!isNew) return { name, description: opt(b.description), updatedAt: new Date() };
      // slug и skuPrefix обязательны в схеме CRM — подбираем свободные
      const base = translit(name) || 'cat';
      let slug = base, i = 1;
      while (await db.collection('categories').findOne({ slug })) slug = `${base}-${++i}`;
      const pBase = base.replace(/-/g, '').slice(0, 3).toUpperCase() || 'CAT';
      let skuPrefix = pBase; i = 1;
      while (await db.collection('categories').findOne({ skuPrefix })) skuPrefix = `${pBase}${++i}`;
      return { name, slug, skuPrefix, type: 'material', description: opt(b.description), sortOrder: 0, isActive: true, deletedAt: null, createdAt: new Date(), updatedAt: new Date() };
    },
    usage: async (db, docs) => {
      const rows = await db.collection('materials').aggregate([{ $match: { deletedAt: null, categoryId: { $in: docs.map((d) => d._id) } } }, { $group: { _id: '$categoryId', n: { $sum: 1 } } }]).toArray();
      const req = await db.collection('supplyrequests').aggregate([{ $match: { deletedAt: null, categoryId: { $in: docs.map((d) => d._id) } } }, { $group: { _id: '$categoryId', n: { $sum: 1 } } }]).toArray();
      const m = new Map<string, number>();
      for (const r of [...rows, ...req]) m.set(String(r._id), (m.get(String(r._id)) ?? 0) + (r.n as number));
      return m;
    },
    related: async (db, d) => {
      const q = { deletedAt: null, categoryId: d._id };
      const [rows, total] = await Promise.all([db.collection('materials').find(q).sort({ name: 1 }).limit(15).project({ name: 1, unit: 1 }).toArray(), count(db, 'materials', { categoryId: d._id })]);
      return { title: 'Позиции склада', total, items: rows.map((r) => ({ label: s(r.name), href: '#stock?open=' + String(r._id) })) };
    },
    reassign: async (db, from, to) => {
      const [a, b] = await Promise.all([
        db.collection('materials').updateMany({ categoryId: from._id }, { $set: { categoryId: to._id } }),
        db.collection('supplyrequests').updateMany({ categoryId: from._id }, { $set: { categoryId: to._id, editedInApp: true } }),
      ]);
      return a.modifiedCount + b.modifiedCount;
    },
    candidates: async (db) => {
      const found = new Map<string, { name: string; uses: number; source: string }>();
      for (const v of await sheetList(db, 'categories')) add(found, v, 0, 'Google-таблица');
      const docs = await db.collection('categories').find({ type: 'material', deletedAt: null }).toArray();
      return missing(docs.map((d) => s(d.name)), found);
    },
    fromName: async (name, db) => (DICTS[0].toDoc({ name }, true, db)),
    options: (docs) => docs.map((d) => s(d.name)),
  },
  ...productGroupDefs({ translit }),
  {
    key: 'units', group: 'Склад и позиции', title: 'Единицы измерения',
    hint: 'Единицы в заявках, на складе и в заказах: «шт», «м», «лист»… Сокращение — то, что видно в строках.',
    coll: 'units', match: { isActive: { $ne: false }, deletedAt: null },
    columns: [{ key: 'label', label: 'Полное название' }],
    fields: [{ key: 'symbol', label: 'Сокращение', required: true, hint: 'Как пишется в строках: шт, м, м², лист' }, { key: 'label', label: 'Полное название', hint: 'Штука, Метр погонный…' }],
    name: (d) => s(d.symbol || d.label || d.key),
    row: (d) => ({ name: s(d.symbol || d.label || d.key), symbol: s(d.symbol || d.key), label: s(d.label) }),
    toDoc: async (b, isNew) => {
      const symbol = s(b.symbol || b.name);
      const base = { symbol, label: s(b.label) || symbol, updatedAt: new Date() };
      return isNew ? { ...base, key: `u-${translit(symbol) || 'x'}-${Date.now().toString(36)}`, category: 'count', isActive: true, isSystem: false, sortOrder: 0, deletedAt: null, createdAt: new Date() } : base;
    },
    usage: async (db, docs) => {
      const [a, b] = await Promise.all([tally(db, 'materials', 'unit'), tally(db, 'supplyrequests', 'unit')]);
      return new Map(docs.map((d) => {
        const keys = new Set([norm(d.symbol), norm(d.key)].filter(Boolean));
        let n = 0; for (const k of keys) n += (a.get(k) ?? 0) + (b.get(k) ?? 0);
        return [String(d._id), n];
      }));
    },
    busy: async (db, d) => {
      const q = { deletedAt: null, unit: { $in: [s(d.symbol), s(d.key)].filter(Boolean).map(sameRe) } };
      return (await db.collection('materials').countDocuments(q, { limit: 1 })) + (await db.collection('supplyrequests').countDocuments(q, { limit: 1 })) > 0;
    },
    related: async (db, d) => {
      const vals = [s(d.symbol), s(d.key)].filter(Boolean);
      const q = { deletedAt: null, unit: { $in: vals } };
      const [rows, total] = await Promise.all([db.collection('materials').find(q).sort({ name: 1 }).limit(15).project({ name: 1 }).toArray(), db.collection('materials').countDocuments(q)]);
      return { title: 'Позиции склада в этих единицах', total, items: rows.map((r) => ({ label: s(r.name), href: '#stock?open=' + String(r._id) })) };
    },
    reassign: async (db, from, to) => {
      const vals = [s(from.symbol), s(from.key)].filter(Boolean);
      const sym = s(to.symbol || to.key);
      const [a, b] = await Promise.all([
        db.collection('materials').updateMany({ unit: { $in: vals } }, { $set: { unit: sym } }),
        db.collection('supplyrequests').updateMany({ unit: { $in: vals } }, { $set: { unit: sym, editedInApp: true } }),
      ]);
      return a.modifiedCount + b.modifiedCount;
    },
    candidates: async (db) => {
      const found = new Map<string, { name: string; uses: number; source: string }>();
      for (const v of await sheetList(db, 'units')) add(found, v, 0, 'Google-таблица');
      for (const [k, n] of await tally(db, 'materials', 'unit')) add(found, k, n, 'склад');
      for (const [k, n] of await tally(db, 'supplyrequests', 'unit')) add(found, k, n, 'заявки');
      const docs = await db.collection('units').find({ isActive: { $ne: false }, deletedAt: null }).toArray();
      return missing(docs.flatMap((d) => [s(d.symbol), s(d.key), s(d.label)]), found);
    },
    fromName: async (name) => ({ symbol: s(name), label: s(name), key: `u-${translit(name) || 'x'}-${Date.now().toString(36)}`, category: 'count', isActive: true, isSystem: false, sortOrder: 0, deletedAt: null, createdAt: new Date(), updatedAt: new Date() }),
    options: (docs) => docs.map((d) => s(d.symbol || d.key)),
    softDelete: { isActive: false },
  },
  // Причины списания (SK-5): `stockmovements.reason` — название; значения по умолчанию добавляет WriteOffReasonsSeed
  simpleList('writeOffReasons', 'Склад и позиции', 'Причины списания', 'Почему материал списан со склада без выдачи: брак, потеря, порча, прочее. Выбирается в окне «Списать».', [], { coll: 'stockmovements', field: 'reason' }),
  {
    key: 'colors', group: 'Склад и позиции', title: 'Цвета',
    hint: 'Цвета покраски и материалов (RAL и свои). Позже — выбор цвета в позиции и заказе.',
    coll: 'color_references', match: { deletedAt: null },
    columns: [{ key: 'hex', label: 'Цвет' }, { key: 'description', label: 'Описание' }],
    fields: [{ key: 'name', label: 'Название', required: true, hint: 'Например: RAL 6005 зелёный мох' }, { key: 'hex', label: 'Цвет', type: 'color' }, { key: 'description', label: 'Описание', type: 'textarea', wide: true }],
    name: (d) => s(d.name),
    row: (d) => ({ name: s(d.name), hex: s(d.hex), description: s(d.description) }),
    toDoc: async (b, isNew) => ({ name: s(b.name), hex: opt(b.hex), description: opt(b.description), updatedAt: new Date(), ...(isNew ? { slug: `${translit(s(b.name)) || 'color'}-${Date.now().toString(36)}`, isActive: true, isSystem: false, deletedAt: null, createdAt: new Date() } : {}) }),
    usage: async (db, docs) => {
      // склад + позиции заказов + заявки: цвет, которого нет на складе, не выглядит неиспользуемым
      const [m, i, r] = await Promise.all([tally(db, 'materials', 'colors'), tally(db, 'incomes', 'color'), tally(db, 'supplyrequests', 'color')]);
      return new Map(docs.map((d) => { const k = norm(d.name); return [String(d._id), (m.get(k) ?? 0) + (i.get(k) ?? 0) + (r.get(k) ?? 0)]; }));
    },
    busy: async (db, d) => {
      const re = sameRe(d.name);
      return (await db.collection('materials').countDocuments({ deletedAt: null, colors: re }, { limit: 1 })) + (await db.collection('incomes').countDocuments({ deletedAt: null, color: re }, { limit: 1 }))
        + (await db.collection('supplyrequests').countDocuments({ deletedAt: null, color: re }, { limit: 1 })) > 0;
    },
    related: async (db, d) => {
      const q = { deletedAt: null, colors: s(d.name) };
      const [rows, total] = await Promise.all([db.collection('materials').find(q).limit(15).project({ name: 1 }).toArray(), db.collection('materials').countDocuments(q)]);
      const qi = { deletedAt: null, color: sameRe(d.name) };
      const [inc, incTotal] = await Promise.all([db.collection('incomes').find(qi).sort({ _id: -1 }).limit(15).project({ orderNo: 1, title: 1, orderId: 1 }).toArray(), db.collection('incomes').countDocuments(qi)]);
      const qr = { deletedAt: null, color: sameRe(d.name) };
      const [req, reqTotal] = await Promise.all([db.collection('supplyrequests').find(qr).sort({ _id: -1 }).limit(15).project({ num: 1, title: 1 }).toArray(), db.collection('supplyrequests').countDocuments(qr)]);
      return {
        title: 'Позиции этого цвета', total, items: rows.map((r) => ({ label: s(r.name), href: '#stock?open=' + String(r._id) })),
        more: [
          { title: 'Позиции заказов', total: incTotal, items: inc.map((r) => ({ label: `${s(r.orderNo)} ${s(r.title)}`.trim(), href: '#orders?open=' + String(r.orderId ?? r._id) })) },
          { title: 'Заявки', total: reqTotal, items: req.map((r) => ({ label: `№${r.num ?? ''} ${s(r.title)}`, href: '#requests?open=' + String(r._id) })) },
        ],
      };
    },
    reassign: async (db, from, to) => {
      const [a, b, c] = await Promise.all([
        db.collection('materials').updateMany({ colors: s(from.name) }, { $set: { 'colors.$': s(to.name) } }),
        db.collection('incomes').updateMany({ color: sameRe(from.name) }, { $set: { color: s(to.name), updatedAt: new Date() } }),
        db.collection('supplyrequests').updateMany({ color: sameRe(from.name) }, { $set: { color: s(to.name), editedInApp: true } }),
      ]);
      return a.modifiedCount + b.modifiedCount + c.modifiedCount;
    },
    options: (docs) => docs.map((d) => s(d.name)),
  },
  metalList('metalAssortments', 'Сортамент / сечение', 'Сечение металла в позиции склада: «Труба 40×20×2», «Лист 2 мм», «Уголок 50×50×5». Выбирается из списка — одно написание для фильтров и отчётов.', 'assortment'),
  metalList('steelGrades', 'Марки стали', 'Марка металла в позиции склада: Ст3, 09Г2С, AISI 304. Выбирается из списка — одно написание для фильтров и отчётов.', 'materialGrade'),

  // ───────── Люди и ФОТ ─────────
  {
    key: 'persons', group: 'Люди и ФОТ', title: 'Сотрудники',
    hint: 'Один список людей для всего приложения: «Кто подал» в заявках, «Кому выдано» со склада, ФОТ. Ставка видна только директору и бухгалтеру.',
    coll: 'persons', match: { deletedAt: null },
    columns: [{ key: 'position', label: 'Должность' }, { key: 'workTypeName', label: 'Вид работ' }, { key: 'statusLabel', label: 'Статус' }, { key: 'phone', label: 'Телефон' }],
    fields: [
      { key: 'lastName', label: 'Фамилия' },
      { key: 'firstName', label: 'Имя', required: true },
      { key: 'patronymic', label: 'Отчество' },
      { key: 'birthDate', label: 'Дата рождения', type: 'date' },
      { key: 'position', label: 'Должность' },
      { key: 'workTypeId', label: 'Вид работ', type: 'select', ref: 'worktypes' },
      { key: 'status', label: 'Статус', type: 'select', options: [{ value: 'active', label: 'Работает' }, { value: 'vacation', label: 'В отпуске' }, { value: 'fired', label: 'Уволен' }] },
      { key: 'salaryKind', label: 'Оплата', type: 'select', options: [{ value: 'month', label: 'Оклад в месяц' }, { value: 'hour', label: 'Почасовая' }] },
      { key: 'salaryRate', label: 'Ставка, ₽', type: 'money', hint: 'Оклад в месяц или цена часа' },
      { key: 'payoutScheduleId', label: 'График выплат', type: 'select', ref: 'payoutSchedules' },
      { key: 'phone', label: 'Телефон' },
      { key: 'email', label: 'Почта' },
      { key: 'notes', label: 'Примечание', type: 'textarea', wide: true },
    ],
    name: personName,
    row: (d) => ({
      name: personName(d), lastName: s(d.lastName), firstName: s(d.firstName), patronymic: s(d.patronymic), position: s(d.position), phone: s(d.phone), email: s(d.email), notes: s(d.notes),
      workTypeId: personWorkTypeIds(d)[0] ? String(personWorkTypeIds(d)[0]) : '', workTypeIds: personWorkTypeIds(d).map(String), payoutScheduleId: d.payoutScheduleId ? String(d.payoutScheduleId) : '',
      status: s(d.status) || 'active', statusLabel: ({ active: 'Работает', vacation: 'В отпуске', fired: 'Уволен' } as Record<string, string>)[s(d.status) || 'active'],
      salaryKind: s(d.salaryKind), salaryRate: d.salaryRate ?? null,
      birthDate: d.birthDate ? new Date(d.birthDate as Date).toISOString().slice(0, 10) : '',
    }),
    toDoc: async (b, isNew, db, id) => {
      const doc: Document = { updatedAt: new Date() };
      for (const k of ['lastName', 'firstName', 'patronymic', 'position', 'phone', 'email', 'notes']) if (b[k] !== undefined) doc[k] = opt(b[k]);
      if (b.status !== undefined) doc.status = ['active', 'vacation', 'fired'].includes(String(b.status)) ? b.status : 'active';
      if (b.salaryKind !== undefined) doc.salaryKind = ['month', 'hour'].includes(String(b.salaryKind)) ? b.salaryKind : null;
      if (b.salaryRate !== undefined) { const n = Number(String(b.salaryRate ?? '').replace(/\s/g, '').replace(',', '.')); doc.salaryRate = Number.isFinite(n) && n > 0 ? n : null; }
      // несколько видов работ: массив workTypeIds (старое workTypeId пишется синхронно — первым); форма со старым одиночным полем чужие виды работ не стирает
      if (b.workTypeIds !== undefined) Object.assign(doc, workTypeFields(b.workTypeIds));
      else if (b.workTypeId !== undefined) {
        const one = oidOrNull(b.workTypeId);
        const cur = !isNew && id && Types.ObjectId.isValid(id) ? await db.collection('persons').findOne({ _id: new Types.ObjectId(id) }, { projection: { workTypeId: 1, workTypeIds: 1 } }) : null;
        if (!cur || String(personWorkTypeIds(cur as Doc)[0] ?? '') !== String(one ?? '')) Object.assign(doc, workTypeFields(one ? [String(one)] : []));
      }
      if (b.payoutScheduleId !== undefined) doc.payoutScheduleId = oidOrNull(b.payoutScheduleId);
      if (b.birthDate !== undefined) { const t = /^\d{4}-\d{2}-\d{2}$/.test(String(b.birthDate)) ? new Date(String(b.birthDate) + 'T00:00:00Z') : null; doc.birthDate = t; }
      if (isNew) Object.assign(doc, { status: doc.status ?? 'active', deletedAt: null, createdAt: new Date() });
      return doc;
    },
    usage: async (db, docs) => {
      const t = await tally(db, 'supplyrequests', 'requestedBy');
      return new Map(docs.map((d) => [String(d._id), Math.max(...personKeys(d).map((k) => t.get(k) ?? 0), 0)]));
    },
    // заявки (кто подал) + выдачи со склада
    busy: async (db, d) => {
      const names = [`${s(d.firstName)} ${s(d.lastName)}`, `${s(d.lastName)} ${s(d.firstName)}`].map((x) => x.trim()).filter(Boolean).map(sameRe);
      if ((await db.collection('supplyrequests').countDocuments({ deletedAt: null, requestedBy: { $in: names } }, { limit: 1 })) > 0) return true;
      return (await db.collection('stockmovements').countDocuments({ issuedToPersonId: d._id, deletedAt: null }, { limit: 1 })) > 0;
    },
    // в заявках человек записан «Имя Фамилия»: каскад — только при смене имени или фамилии (не должности и телефона)
    renameKey: (d) => norm(`${s(d.firstName)} ${s(d.lastName)}`),
    related: async (db, d) => {
      const names = [`${s(d.firstName)} ${s(d.lastName)}`, `${s(d.lastName)} ${s(d.firstName)}`].map((x) => x.trim()).filter(Boolean);
      const q = { deletedAt: null, requestedBy: { $in: names.map((n) => new RegExp(`^\\s*${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i')) } };
      const iq = { issuedToPersonId: d._id, type: 'out', deletedAt: null, cancelledAt: null };
      const [rows, total, mvs, mvTotal] = await Promise.all([db.collection('supplyrequests').find(q).sort({ requestDate: -1 }).limit(15).project({ num: 1, title: 1 }).toArray(), db.collection('supplyrequests').countDocuments(q),
        db.collection('stockmovements').find(iq).sort({ date: -1 }).limit(15).project({ materialId: 1, qty: 1, date: 1 }).toArray(), db.collection('stockmovements').countDocuments(iq)]);
      // что выдано со склада этому сотруднику (TASKS Л.3)
      const mats = mvs.length ? await db.collection('materials').find({ _id: { $in: mvs.map((m) => m.materialId) } }, { projection: { name: 1, unit: 1 } }).toArray() : [];
      const mat = new Map(mats.map((m) => [String(m._id), m]));
      const day = (v: unknown) => (v instanceof Date ? v.toLocaleDateString('ru-RU') : '');
      const issued: Related = { title: 'Выдано со склада', total: mvTotal, items: mvs.map((m) => ({ label: s(mat.get(String(m.materialId))?.name) || 'позиция', sub: `${m.qty} ${s(mat.get(String(m.materialId))?.unit)} · ${day(m.date)}`, href: '#movements?open=' + String(m._id) })) };
      return { title: 'Заявки, которые подал', total, items: rows.map((r) => ({ label: `№${r.num ?? ''} ${s(r.title)}`, href: '#requests?open=' + String(r._id) })), more: [issued] };
    },
    reassign: async (db, from, to) => {
      const names = [`${s(from.firstName)} ${s(from.lastName)}`, `${s(from.lastName)} ${s(from.firstName)}`].map((x) => x.trim()).filter(Boolean);
      const target = `${s(to.firstName)} ${s(to.lastName)}`.trim();
      return (await db.collection('supplyrequests').updateMany({ requestedBy: { $in: names } }, { $set: { requestedBy: target, editedInApp: true } })).modifiedCount;
    },
    candidates: async (db) => {
      const found = new Map<string, { name: string; uses: number; source: string }>();
      for (const v of await sheetList(db, 'people')) add(found, v, 0, 'Google-таблица');
      const raw = await db.collection('supplyrequests').aggregate([{ $match: { deletedAt: null, requestedBy: { $nin: [null, ''] } } }, { $group: { _id: '$requestedBy', n: { $sum: 1 } } }]).toArray();
      for (const r of raw) add(found, String(r._id), r.n as number, 'заявки');
      const docs = (await db.collection('persons').find({ deletedAt: null }).toArray()) as Doc[];
      const known = new Set(docs.flatMap(personKeys));
      return [...found.values()].filter((x) => !known.has(norm(x.name))).sort((a, b) => b.uses - a.uses);
    },
    // «Сергей Апошнянский» → имя + фамилия (так пишут в заявках)
    fromName: async (name) => { const [first, ...rest] = s(name).split(' '); return { firstName: first, lastName: rest.join(' ') || null, status: 'active', deletedAt: null, createdAt: new Date(), updatedAt: new Date() }; },
    options: (docs) => docs.filter((d) => d.status !== 'fired').map((d) => `${s(d.firstName)} ${s(d.lastName)}`.trim()),
  },
  {
    key: 'worktypes', group: 'Люди и ФОТ', title: 'Виды работ',
    hint: 'Сварщик, маляр, столяр… — у сотрудника; со склада выдаётся «вид работ → человек».',
    coll: 'worktypes', match: { deletedAt: null },
    columns: [{ key: 'description', label: 'Описание' }],
    fields: [{ key: 'name', label: 'Название', required: true }, { key: 'description', label: 'Описание', type: 'textarea', wide: true }],
    name: (d) => s(d.name),
    row: (d) => ({ name: s(d.name), description: s(d.description) }),
    toDoc: async (b, isNew) => ({ name: s(b.name), description: opt(b.description), updatedAt: new Date(), ...(isNew ? { isActive: true, hourlyRate: 0, deletedAt: null, createdAt: new Date() } : {}) }),
    usage: async (db, docs) => {
      const rows = await db.collection('persons').aggregate([{ $match: { deletedAt: null, $or: [{ workTypeId: { $in: docs.map((d) => d._id) } }, { workTypeIds: { $in: docs.map((d) => d._id) } }] } }, { $project: { ids: { $setUnion: [{ $ifNull: ['$workTypeIds', []] }, { $cond: [{ $ifNull: ['$workTypeId', false] }, ['$workTypeId'], []] }] } } }, { $unwind: '$ids' }, { $match: { ids: { $in: docs.map((d) => d._id) } } }, { $group: { _id: '$ids', n: { $sum: 1 } } }]).toArray();
      return new Map(rows.map((r) => [String(r._id), r.n as number]));
    },
    related: async (db, d) => {
      const rows = (await db.collection('persons').find({ deletedAt: null, $or: [{ workTypeId: d._id }, { workTypeIds: d._id }] }).sort({ lastName: 1 }).limit(50).toArray()) as Doc[];
      return { title: 'Сотрудники', total: rows.length, items: rows.map((r) => ({ label: personName(r), sub: s(r.position), href: '#dicts?d=persons&of=dict&open=' + String(r._id) })) };
    },
    reassign: async (db, from, to) => {
      const one = (await db.collection('persons').updateMany({ workTypeId: from._id }, { $set: { workTypeId: to._id } })).modifiedCount;
      await db.collection('persons').updateMany({ workTypeIds: from._id }, { $addToSet: { workTypeIds: to._id } });
      await db.collection('persons').updateMany({ workTypeIds: from._id }, { $pull: { workTypeIds: from._id } as never });
      return one;
    },
    options: (docs) => docs.map((d) => s(d.name)),
  },
  {
    ...simpleList('payoutSchedules', 'Люди и ФОТ', 'Графики выплат', 'Когда платим зарплату: «10 и 25 числа», «5-го», «раз в две недели». Выбирается у сотрудника — один раз здесь, а не у каждого.',
      [{ key: 'days', label: 'Дни выплат', hint: 'Числа месяца через запятую: 10, 25' }, { key: 'notes', label: 'Что платим', hint: 'аванс и зарплата, премия…' }]),
    usage: async (db, docs) => {
      const rows = await db.collection('persons').aggregate([{ $match: { deletedAt: null, payoutScheduleId: { $in: docs.map((d) => d._id) } } }, { $group: { _id: '$payoutScheduleId', n: { $sum: 1 } } }]).toArray();
      return new Map(rows.map((r) => [String(r._id), r.n as number]));
    },
    related: async (db, d) => {
      const rows = (await db.collection('persons').find({ deletedAt: null, payoutScheduleId: d._id }).sort({ lastName: 1 }).limit(50).toArray()) as Doc[];
      return { title: 'Сотрудники на этом графике', total: rows.length, items: rows.map((r) => ({ label: personName(r), sub: s(r.position), href: '#dicts?d=persons&of=dict&open=' + String(r._id) })) };
    },
    reassign: async (db, from, to) => (await db.collection('persons').updateMany({ payoutScheduleId: from._id }, { $set: { payoutScheduleId: to._id } })).modifiedCount,
    candidates: async () => [],
  },

  // ───────── Заявки и счета ─────────
  simpleList('invoiceTypes', 'Заявки и счета', 'Типы счетов', 'Поле «Тип счёта» в заявке и счёте: счёт на оплату, счёт-договор, УПД…', [],
    { coll: 'supplyrequests', field: 'sheetExtra.invoiceType' }, ['Счет на оплату', 'Счет-договор', 'Счет', 'УПД'], 'invoiceTypes'),
  paymentFormsList(),
  simpleList('services', 'Заявки и счета', 'Услуги', 'Услуги в счетах: доставка, погрузка, аренда техники…', [{ key: 'notes', label: 'Примечание' }], undefined, [], 'services'),

  productSeriesList(),

  // ───────── Паспорта (БЗ-6, docs/PASSPORTS-V2.md §2, §3.2, §3.3): правят директор и админ ─────────
  // ПВ2 (2026-10-25): порядок полей = порядок в карточке — частое сверху; коды и настроечное (tech) — внизу, не столбцы таблицы.
  // code у существующей записи не меняется (на него ссылаются тексты и изделия); у новой можно не вводить — сервер сделает из названия.
  {
    ...simpleList('passportCategories', 'Паспорта', 'Категории паспортов',
      'Вид изделия для паспорта: какие разделы, нормативы, обязательные рисунки и значения по умолчанию. ALL — «Для всех»: его тексты получают все категории. Не путать с категориями каталога — связь в поле «Категории каталога».',
      [
        { key: 'serviceLifeYears', label: 'Срок службы, лет' },
        { key: 'warrantyMonths', label: 'Гарантия, мес.' },
        { key: 'standards', label: 'Нормативы', wide: true, hint: 'На какие ГОСТ и регламенты ссылаются паспорта этой категории — выберите из списка', ref: { dict: 'passportStandards', multiple: true } },
        TECH({ key: 'code', label: 'Код категории', required: true, lockAfterCreate: true, hint: 'Короткое имя латиницей (ALL, DIO, DSP, TRN, WRK, BLG): по нему тексты, шаблоны и паспорта находят категорию. После создания не меняется' }),
        TECH({ key: 'catalogNames', label: 'Какие категории каталога сюда относятся', wide: true, hint: 'Устарело: задайте категорию паспорта в группе каталога («Группы изделий»). Названия категорий каталога через запятую, как в карточке изделия: «Уличный тренажёр, Тренажёр уличный». По ним изделие получает эту категорию паспорта' }),
        TECH({ key: 'requiredFields', label: 'Какие поля паспорта обязательны', type: 'textarea', wide: true, hint: 'Без них паспорт не выпустить. По строке ключ поля: ageFrom, ageTo, heightMin, heightMax, weightMax, maxUsers, fallHeight, siteLength, siteWidth, serviceLifeYears (можно «ключ — подпись»). Пусто — как в программе по умолчанию' }),
        TECH({ key: 'allowedFields', label: 'Какие поля показывать в форме', type: 'textarea', wide: true, hint: 'Поля раздела «Ограничения и техданные», которые бывают у этой категории: по строке ключ (ageFrom, heightMin, maxUsers…). Пусто — все. Обязательные добавятся сами' }),
        TECH({ key: 'fieldHints', label: 'Подсказки к полям формы', type: 'textarea', wide: true, hint: 'Серая подсказка под полем в форме паспорта, только для этой категории. По строке «ключ — подсказка»: heightMin — обычно от 1400 мм' }),
        TECH({ key: 'fieldDefaults', label: 'Значения полей по умолчанию', type: 'textarea', wide: true, hint: 'Подставляются серым в пустые поля формы паспорта, можно поправить. По строке «ключ — значение»: heightMin — 1400' }),
        TECH({ key: 'requiredImages', label: 'Какие рисунки обязательны', type: 'textarea', wide: true, hint: 'Без этих картинок паспорт не выпустить. По строке вид рисунка: overview, dimensions, safety_zone, foundation…' }),
        TECH({ key: 'extraSections', label: 'Дополнительные разделы паспорта', type: 'textarea', wide: true, hint: 'Разделы сверх общего набора, которые нужны только этой категории (по строке)' }),
      ]),
    ...ppUsage({ pp: 'passportCategory', dicts: [{ dict: 'passportElements', field: 'categories', title: 'Элемент' }, { dict: 'passportStyle', field: 'category', title: 'Оформление' }] }),
    editRoles: ['director'],
  },
  {
    ...standardsView(simpleList('passportStandards', 'Паспорта', 'Нормативы',
    'ГОСТ, ТР ЕАЭС, СП, на которые ссылается текст паспорта: в тексте — {std:КОД}, подставляется обозначение. Статус и дата проверки — чтобы не ссылаться на отменённое (паспорт предупредит).',
    [
      { key: 'title', label: 'Полное наименование', wide: true },
      { key: 'status', label: 'Статус', type: 'select', options: ['действует', 'проверить', 'не обязателен', 'заменён', 'не применять'].map((v) => ({ value: v, label: v })) },
      { key: 'checkedAt', label: 'Проверено (дата)', hint: 'ГГГГ-ММ-ДД — когда сверяли по официальной базе' },
      { key: 'applies', label: 'Где применяем', wide: true },
      TECH({ key: 'code', label: 'Код для текста', required: true, lockAfterCreate: true, hint: 'Короткое имя латиницей, без пробелов: GOST_R_52301. В тексте паспорта {std:GOST_R_52301} заменяется обозначением норматива. После создания не меняется' }),
    ])),
    ...ppUsage({ dicts: [{ dict: 'passportCategories', field: 'standards', title: 'Категория' }, { dict: 'passportElements', field: 'standard', title: 'Элемент' }] }),
    editRoles: ['director'],
  },
  {
    ...simpleList('passportElements', 'Паспорта', 'Функциональные элементы',
      'Из чего состоит изделие по назначению (турник, брусья, горка…): фраза для описания, правила пользования и что проверять при ТО. Подставляются в текст паспорта по составу изделия.',
      [
        { key: 'inDescription', label: 'В описании', wide: true, hint: 'Фраза для раздела «Описание», напр. «горизонтальная перекладина для подтягиваний»' },
        // ПВ (2026-10-25): «Назначение» паспорта — только из «Текстов паспорта»; старое поле элемента не показываем
        { key: 'usageRules', label: 'Правила пользования', type: 'textarea', wide: true, hint: 'По строке на шаг' },
        { key: 'inspect', label: 'Что проверять при ТО', type: 'textarea', wide: true, hint: 'По строке на пункт' },
        { key: 'standard', label: 'Норматив', hint: 'На какой норматив опирается элемент — выберите из списка', ref: { dict: 'passportStandards', multiple: false } },
        { key: 'categories', label: 'Для каких категорий', wide: true, hint: 'Категории паспортов, где этот элемент бывает — отметьте нужные' },
        TECH({ key: 'code', label: 'Код элемента', required: true, lockAfterCreate: true, hint: 'Короткое имя латиницей (HORIZONTAL_BAR): по нему изделия и дефекты ссылаются на элемент. После создания не меняется' }),
      ]),
    ...ppUsage({ pp: 'elements', dicts: [{ dict: 'passportDefects', field: 'applies', title: 'Дефект' }] }),
    editRoles: ['director'],
  },
  {
    ...simpleList('passportMaterials', 'Паспорта', 'Материалы и покрытия',
      'Материалы изделий: фраза «изготовлено из…», уход и ремонт, типичные дефекты. Подставляются в паспорт по материалам изделия.',
      [
        { key: 'madeOf', label: 'Изготовлено из…', wide: true, hint: 'В родительном падеже: «стальной трубы с порошковым покрытием»' },
        { key: 'care', label: 'Уход и ремонт', type: 'textarea', wide: true, hint: 'По строке на пункт' },
        { key: 'phrase', label: 'Фраза покрытия', wide: true, hint: 'Только у покрытия, целым предложением: «Окрашено порошковой краской методом запекания в заводских условиях.»' },
        { key: 'defects', label: 'Типичные дефекты', wide: true, hint: 'Какие дефекты ищут у этого материала при осмотре — выберите из списка', ref: { dict: 'passportDefects', multiple: true } },
        { key: 'categories', label: 'Для каких категорий', wide: true, hint: 'Категории паспортов, где этот материал бывает; пусто — для всех' },
        // МИ: устаревшая запись — на неё ссылаются выпущенные паспорта, удалять нельзя; в новых таблицах не предлагается
        YES_NO('hideInNew', 'Не предлагать в новых', 'Да — нет в выборе таблицы материалов новых изделий и паспортов; где уже выбрана — остаётся как есть'),
        // МИ: материалы изделия таблицей — текст «Изготовлено из…» собирается из этих полей (common/catalog/materials-text.ts)
        TECH({ key: 'kind', label: 'Тип', type: 'select', options: [{ value: 'material', label: 'материал' }, { value: 'coating', label: 'покрытие' }], hint: 'Материал или покрытие; пусто — материал. От этого зависит, как строится фраза «Изготовлено из…»' }),
        TECH({ key: 'genSingular', label: 'Из чего — один размер', hint: 'Родительный падеж, ед. ч.: «стальной трубы». Нужно для автотекста «Изготовлено из…»' }),
        TECH({ key: 'genPlural', label: 'Из чего — несколько размеров', hint: 'Родительный падеж, мн. ч.: «стальных труб». Нужно для автотекста «Изготовлено из…»' }),
        TECH({ key: 'sizeTemplate', label: 'Шаблон размера', hint: '{sizes} — размеры через «и» / запятую, «мм» — один раз: «{sizes} мм», «толщиной {sizes} мм»' }),
        TECH({ key: 'code', label: 'Код материала', required: true, lockAfterCreate: true, hint: 'Короткое имя латиницей (STEEL_POWDER): по нему сортамент, дефекты и изделия находят материал. После создания не меняется' }),
      ]),
    ...withProducts(
      ppUsage({ pp: 'materialIds', dicts: [{ dict: 'passportDefects', field: 'applies', title: 'Дефект' }, { dict: 'passportSortament', field: 'material', title: 'Сортамент' }] }),
      async (_db, d) => ({ $or: [{ 'materialsSpec.rows.materialId': d._id }, { 'materialsSpec.coatingIds': d._id }] }),
      async (db, from, to) => {
        const p = db.collection('products');
        let n = (await p.updateMany({ 'materialsSpec.rows.materialId': from._id }, { $set: { 'materialsSpec.rows.$[r].materialId': to._id } }, { arrayFilters: [{ 'r.materialId': from._id }] })).modifiedCount;
        await p.updateMany({ $and: [{ 'materialsSpec.coatingIds': from._id }, { 'materialsSpec.coatingIds': { $ne: to._id } }] }, { $push: { 'materialsSpec.coatingIds': to._id } } as Document);
        n += (await p.updateMany({ 'materialsSpec.coatingIds': from._id }, { $pull: { 'materialsSpec.coatingIds': from._id } } as Document)).modifiedCount;
        // МЦ-2: позиции склада, связанные с материалом паспорта
        n += (await db.collection('materials').updateMany({ 'passportSpec.materialId': from._id }, { $set: { 'passportSpec.materialId': to._id } })).modifiedCount;
        return n;
      }),
    editRoles: ['director'],
  },
  {
    // МИ: размеры по материалу (∅89×3, лист 2) — выбор в таблице «Материалы изделия»; размер без «мм», единица — в шаблоне материала
    ...simpleList('passportSortament', 'Паспорта', 'Размеры материалов',
      'Размеры по материалу: ∅89×3, ∅33,5×2,8 у трубы, 2 и 6 у листа (без «мм» — единица в шаблоне материала). Выбираются в таблице материалов изделия; один размер у разных материалов — разные записи.',
      [{ key: 'material', label: 'Материал', required: true, hint: 'К какому материалу относится размер — выберите из «Материалов и покрытий»', ref: { dict: 'passportMaterials', multiple: false } },
        YES_NO('incomplete', 'Неполный размер', 'Да — размер без стенки (∅33,5 у трубы, профиль без стенки): в выборе — ниже полных, с пометкой')]),
    toDoc: async (b, isNew, db) => {
      const material = s(b.material).toUpperCase();
      if (!material) throw new BadRequestException('Укажите код материала из «Материалов и покрытий»');
      if (!(await db.collection('dict_values').findOne({ dict: 'passportMaterials', code: material, deletedAt: null }, { projection: { _id: 1 } }))) throw new BadRequestException(`Нет материала с кодом ${material} в «Материалах и покрытиях»`);
      return { ...(isNew ? { dict: 'passportSortament', deletedAt: null, createdAt: new Date() } : {}), name: normSize(b.name), material, incomplete: b.incomplete === true || b.incomplete === 'true' ? true : null, updatedAt: new Date() };
    },
    dupKey: (d) => `${s(d.material).toUpperCase()}|${norm(normSize(d.name))}`,
    ...withProducts(noUsage,
      async (db, d) => { const m = await matIdsByCode(db, s(d.material)); return m.length && s(d.name) ? { 'materialsSpec.rows': { $elemMatch: { materialId: { $in: m }, sizes: s(d.name) } } } : null; },
      async (db, from, to) => {
        if (s(from.material) !== s(to.material)) throw new BadRequestException('Объединять можно размеры одного материала');
        const m = await matIdsByCode(db, s(from.material));
        if (!m.length) return 0;
        return (await db.collection('products').updateMany({ 'materialsSpec.rows': { $elemMatch: { materialId: { $in: m }, sizes: s(from.name) } } },
          { $set: { 'materialsSpec.rows.$[r].sizes.$[z]': s(to.name) } }, { arrayFilters: [{ 'r.materialId': { $in: m } }, { z: s(from.name) }] })).modifiedCount;
      }),
    editRoles: ['director'],
  },
  // ПЧ-3: тип изделия подставляет части и материалы в таблицу паспорта
  simpleList('passportTypes', 'Паспорта', 'Типы изделий',
    'Части и материалы по умолчанию. В паспорте: «Подставить по типу» подбирает тип по словам в названии, размеры сверяют с чертежом.',
    [
      { key: 'category', label: 'Категория паспорта', hint: 'Код: TRN, WRK, BLG' },
      { key: 'words', label: 'Слова в названии', wide: true, hint: 'Через |: лыжн|скороход|маятник' },
      { key: 'composition', label: 'Состав', type: 'textarea', wide: true, hint: 'Строка: часть; код материала; размер. Например: Стойка; PIPE_STEEL; ∅89×3' },
      { key: 'coatings', label: 'Покрытия', wide: true, hint: 'Коды через запятую: COAT_POWDER, COAT_OIL' },
    ]),
  {
    // МИ: «Состоит из стоек, перекладин и хомутов» — части в таблице материалов изделия
    ...simpleList('passportParts', 'Паспорта', 'Части изделия',
      'Из чего состоит изделие по деталям: стойка, перекладина, хомут… В тексте паспорта — «Состоит из стоек, перекладин и хомутов».',
      [
        { key: 'genPlural', label: 'Родительный падеж, мн. ч.', hint: '«стоек» — так в тексте «Состоит из…»' },
        { key: 'genSingular', label: 'Родительный падеж, ед. ч.', hint: '«стойки»' },
        { key: 'categories', label: 'Для каких категорий', wide: true, hint: 'Категории паспортов, где эта часть бывает; пусто — для всех' },
      ]),
    ...withProducts(noUsage,
      async (_db, d) => ({ 'materialsSpec.rows.partIds': d._id }),
      async (db, from, to) => (await db.collection('products').updateMany({ 'materialsSpec.rows.partIds': from._id },
        { $set: { 'materialsSpec.rows.$[].partIds.$[p]': to._id } }, { arrayFilters: [{ p: from._id }] })).modifiedCount),
    editRoles: ['director'],
  },
  {
    ...simpleList('passportDefects', 'Паспорта', 'Дефекты',
      'Типовые дефекты, которые ищут при осмотре, и что с ними делать. Попадают в таблицу «Дефект — мера — период» паспорта.',
      [
        { key: 'measure', label: 'Мера', wide: true, hint: 'Что делать при обнаружении' },
        { key: 'period', label: 'Период проверки', type: 'select', options: ['ежедневно', 'ежемесячно', 'ежеквартально', 'ежегодно'].map((v) => ({ value: v, label: v })) },
        { key: 'tolerance', label: 'Допуск', wide: true, hint: 'Что считается допустимым; число — только если оно общепринятое' },
        { key: 'photoId', label: 'Картинка', type: 'photo', hint: 'Миниатюра дефекта в таблице ТО паспорта; перетащите файл, вставьте Ctrl+V или выберите' },
        // два справочника в одном поле: dict — через запятую (хранение прежнее — коды через запятую)
        { key: 'applies', label: 'К чему относится', wide: true, hint: 'Элементы и материалы, у которых бывает этот дефект — выберите из списка', ref: { dict: 'passportElements,passportMaterials', multiple: true } },
        TECH({ key: 'code', label: 'Код дефекта', required: true, lockAfterCreate: true, hint: 'Короткое имя латиницей (CORROSION): по нему материалы ссылаются на дефект. После создания не меняется' }),
      ]),
    ...ppUsage({ dicts: [{ dict: 'passportMaterials', field: 'defects', title: 'Материал' }] }),
    editRoles: ['director'],
  },
  {
    ...simpleList('passportInstall', 'Паспорта', 'Способы установки',
      'Как изделие крепится на месте: текст монтажа, требования к основанию и какие рисунки обязательны.',
      [
        { key: 'montage', label: 'Текст монтажа', type: 'textarea', wide: true, hint: 'По строке на шаг' },
        { key: 'baseRequirements', label: 'Требования к основанию', type: 'textarea', wide: true, hint: 'По строке на пункт' },
        // Э9.5: стандартные схемы узлов — попадают в паспорт с этим способом установки, если у паспорта нет своих
        { key: 'schemesFoundation', label: 'Стандартные схемы: фундамент / опоры', type: 'photos', wide: true, hint: 'Разрез узла: покрытие, грунт, бетон, щебень, размеры' },
        { key: 'schemesHoles', label: 'Стандартные схемы: скважины / разметка', type: 'photos', wide: true, hint: 'План с расстояниями между опорами' },
        { key: 'schemesMounting', label: 'Стандартные схемы: монтаж', type: 'photos', wide: true },
        { key: 'categories', label: 'Для каких категорий', wide: true, hint: 'Категории паспортов, где этот способ бывает; пусто — для всех' },
        TECH({ key: 'requiredImages', label: 'Какие рисунки обязательны', type: 'textarea', wide: true, hint: 'Без этих картинок паспорт с этим способом установки не выпустить. По строке: foundation, holes…' }),
        TECH({ key: 'code', label: 'Код способа', required: true, lockAfterCreate: true, hint: 'Короткое имя латиницей (CONCRETE_POSTS): по нему паспорта и изделия находят способ. После создания не меняется' }),
      ]),
    ...ppUsage({ pp: 'installationTypeId', dicts: [{ dict: 'passportDefects', field: 'applies', title: 'Дефект' }] }),
    editRoles: ['director'],
  },
  passportPhrasesDef({
    // ТЭ (2026-10-23) → ПВ (2026-10-25): тексты разделов паспорта деревом «раздел → варианты → подварианты» (passportPhrasesDef:
    // поля, проверки, «Используется»). В паспорте и изделии выбирается из дерева воронкой; выданные паспорта хранят свой текст
    ...simpleList('passportPhrases', 'Паспорта', 'Тексты паспорта',
      'Тексты разделов паспорта (Назначение, Установка, Монтаж…): раздел → 2–3 варианта → при нужде подвариант → один текст. Галочки категорий и «Для всех» решают, кому вариант показывается. Если вариант один — он подставляется сам. Ненужное — «в корзину» (выданные паспорта хранят свой текст).',
      [
        { key: 'section', label: 'Раздел', type: 'select', required: true, options: [{ value: 'purpose', label: 'Назначение' }, { value: 'installation', label: 'Установка' }] },
        { key: 'categories', label: 'Категории', wide: true, hint: 'Коды категорий через запятую: TRN, WRK, BLG (благоустройство), DIO, DSP' },
        { key: 'text', label: 'Текст', type: 'textarea', required: true, wide: true },
      ]),
    usage: async (db, docs) => {
      const field = (d: Doc) => (d.section === 'installation' ? 'installationMethod' : 'purpose');
      return new Map(await Promise.all(docs.map(async (d) => [String(d._id), s(d.text) ? await db.collection('productpassports').countDocuments({ deletedAt: null, [field(d)]: s(d.text) }) : 0] as [string, number])));
    },
    related: async (db, d) => {
      const f = d.section === 'installation' ? 'installationMethod' : 'purpose';
      const q = { deletedAt: null, [f]: s(d.text) };
      const [pp, total] = await Promise.all([db.collection('productpassports').find(q).sort({ _id: -1 }).limit(15).project({ passportNumber: 1, name: 1 }).toArray(), db.collection('productpassports').countDocuments(q)]);
      return { title: 'Паспорта с этим текстом', total, items: pp.map((p) => ({ label: `Паспорт № ${s(p.passportNumber) || '— (черновик)'} ${s(p.name)}`, href: '#passports?of=passports&open=' + String(p._id) })) };
    },
    reassign: async () => 0, // выданные паспорта хранят свой текст — при объединении не переписываем
    editRoles: ['director'],
  }),
  {
    ...simpleList('passportStyle', 'Паспорта', 'Оформление',
      'Как выглядит PDF паспорта: цвет категории, фон обложки, рамка и пиктограммы правил. Запись с «Использовать = нет» в PDF не попадает.',
      [
        { key: 'kind', label: 'Вид', type: 'select', options: ['цвет категории', 'фон обложки', 'рамка', 'пиктограмма правил'].map((v) => ({ value: v, label: v })) },
        { key: 'color', label: 'Цвет', type: 'color' },
        { key: 'photoId', label: 'Картинка', type: 'photo', hint: 'Пиктограмма или фон; перетащите файл, вставьте Ctrl+V или выберите' },
        { key: 'use', label: 'Использовать', type: 'select', options: ['да', 'нет'].map((v) => ({ value: v, label: v })) },
        { key: 'text', label: 'Подпись', wide: true, hint: 'Для пиктограммы правил; можно {maxUsers}' },
        { key: 'category', label: 'Для какой категории', hint: 'Код категории (ALL, DIO, DSP, TRN, WRK, BLG) или пусто — для всех' },
        TECH({ key: 'code', label: 'Код оформления', required: true, lockAfterCreate: true, hint: 'Короткое имя латиницей (COVER_TRN, FRAME_ALL, ICON_NO_CLIMB): по нему PDF находит нужное оформление. После создания не меняется' }),
      ]),
    editRoles: ['director'],
  },
];

/** Подписи правой панели (2026-10-25, замечание пользователя: «новая запись чего?»): заголовок новой записи и подпись поля «Название». */
export const DICT_UI: Record<string, { newTitle: string; nameLabel?: string }> = {
  categories: { newTitle: 'Новая категория' }, units: { newTitle: 'Новая единица измерения' }, colors: { newTitle: 'Новый цвет' },
  persons: { newTitle: 'Новый сотрудник' }, worktypes: { newTitle: 'Новый вид работ' }, paymentForms: { newTitle: 'Новая форма оплаты' },
  writeOffReasons: { newTitle: 'Новая причина списания' }, payoutSchedules: { newTitle: 'Новый график выплат' }, invoiceTypes: { newTitle: 'Новый тип счёта' },
  services: { newTitle: 'Новая услуга' }, passportCategories: { newTitle: 'Новая категория паспорта' }, passportStandards: { newTitle: 'Новый норматив', nameLabel: 'Обозначение (коротко)' },
  passportElements: { newTitle: 'Новый функциональный элемент' }, passportMaterials: { newTitle: 'Новый материал или покрытие' },
  passportSortament: { newTitle: 'Новый размер материала', nameLabel: 'Размер (∅89×3, 2, 27×120)' }, passportParts: { newTitle: 'Новая часть изделия' },
  passportDefects: { newTitle: 'Новый дефект' }, passportInstall: { newTitle: 'Новый способ установки' }, passportPhrases: { newTitle: 'Новый текст паспорта' },
  productSeries: { newTitle: 'Новая серия' }, productGroups: { newTitle: 'Новая группа изделий' }, productSections: { newTitle: 'Новый раздел изделий' },
  passportStyle: { newTitle: 'Новый элемент оформления' },
};
/** Поля справочника с подписью «Название» из DICT_UI. */
export const uiFields = (d: DictDef) => { const l = DICT_UI[d.key]?.nameLabel; return l ? d.fields.map((f) => (f.key === 'name' ? { ...f, label: l } : f)) : d.fields; };

export const DICTS: DictDef[] = BASE.map((d) => ({ ...d, ...DICT_META[d.key] }));
export const DICT = new Map(DICTS.map((d) => [d.key, d]));
