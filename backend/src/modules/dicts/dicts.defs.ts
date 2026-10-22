import type { mongo } from 'mongoose';
import { Types } from 'mongoose';
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
export type Field = { key: string; label: string; type?: 'text' | 'textarea' | 'select' | 'money' | 'color' | 'photo' | 'photos'; required?: boolean; options?: { value: string; label: string }[]; ref?: string; hint?: string; wide?: boolean };
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
  toDoc(body: Record<string, unknown>, isNew: boolean, db: Db): Promise<Document>;
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
}

const s = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();
const opt = (v: unknown) => s(v) || null;
/** Значение поля из тела запроса по типу: картинки — только валидные id фото. */
const isOid = (v: unknown) => Types.ObjectId.isValid(String(v ?? '')) && String(v).length === 24;
const fieldValue = (f: Field, v: unknown) => {
  if (f.type === 'photos') return (Array.isArray(v) ? v : []).map(String).filter(isOid);
  if (f.type === 'photo') { const x = Array.isArray(v) ? v[0] : v; return isOid(x) ? String(x) : null; }
  return opt(v);
};
const oidOrNull = (v: unknown) => (v && Types.ObjectId.isValid(String(v)) ? new Types.ObjectId(String(v)) : null);
const count = async (db: Db, coll: string, q: Document) => db.collection(coll).countDocuments({ deletedAt: null, ...q });
/** Сколько раз встречается каждое строковое значение поля (нормализовано). */
async function tally(db: Db, coll: string, field: string, extra: Document = {}) {
  const rows = await db.collection(coll).aggregate([{ $match: { deletedAt: null, ...extra, [field]: { $nin: [null, ''] } } }, { $group: { _id: '$' + field, n: { $sum: 1 } } }]).toArray();
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
const translit = (t: string) => t.toLowerCase().replace(/[а-яё]/g, (c) => ({ а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya' } as Record<string, string>)[c] ?? '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const personName = (d: Doc) => [d.lastName, d.firstName, d.patronymic].map(s).filter(Boolean).join(' ');
/** «Кто подал» в заявках пишется «Имя Фамилия» — считаем оба порядка. */
const personKeys = (d: Doc) => [norm(`${s(d.firstName)} ${s(d.lastName)}`), norm(`${s(d.lastName)} ${s(d.firstName)}`), norm(d.firstName)].filter(Boolean);

/** Простые списки data-core: { dict, name, notes, days?, … } */
function simpleList(key: string, group: string, title: string, hint: string, extra: Field[], usage?: { coll: string; field: string }, defaults: string[] = [], sheetKey?: string): DictDef {
  return {
    key, group, title, hint, coll: 'dict_values', match: { dict: key, deletedAt: null },
    columns: extra.map((f) => ({ key: f.key, label: f.label })),
    fields: [{ key: 'name', label: 'Название', required: true, wide: true }, ...extra],
    name: (d) => s(d.name),
    row: (d) => ({ name: s(d.name), ...Object.fromEntries(extra.map((f) => [f.key, d[f.key] ?? ''])) }),
    toDoc: async (b, isNew) => ({ ...(isNew ? { dict: key, deletedAt: null, createdAt: new Date() } : {}), name: s(b.name), ...Object.fromEntries(extra.map((f) => [f.key, fieldValue(f, b[f.key])])), updatedAt: new Date() }),
    usage: async (db, docs) => {
      if (!usage) return new Map();
      const t = await tally(db, usage.coll, usage.field);
      return new Map(docs.map((d) => [String(d._id), t.get(norm(d.name)) ?? 0]));
    },
    related: async (db, d) => {
      if (!usage) return { title: '', items: [], total: 0 };
      const q = { deletedAt: null, [usage.field]: new RegExp(`^\\s*${s(d.name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i') };
      const [rows, total] = await Promise.all([db.collection(usage.coll).find(q).sort({ _id: -1 }).limit(15).project({ num: 1, title: 1, requestDate: 1 }).toArray(), db.collection(usage.coll).countDocuments(q)]);
      return { title: 'Заявки', total, items: rows.map((r) => ({ label: `№${r.num ?? ''} ${s(r.title)}`, href: '#requests?open=' + String(r._id) })) };
    },
    reassign: async (db, from, to) => {
      if (!usage) return 0;
      const re = new RegExp(`^\\s*${s(from.name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i');
      return (await db.collection(usage.coll).updateMany({ [usage.field]: re }, { $set: { [usage.field]: s(to.name), editedInApp: true } })).modifiedCount;
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

export const DICTS: DictDef[] = [
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
      const t = await tally(db, 'materials', 'colors');
      return new Map(docs.map((d) => [String(d._id), t.get(norm(d.name)) ?? 0]));
    },
    related: async (db, d) => {
      const q = { deletedAt: null, colors: s(d.name) };
      const [rows, total] = await Promise.all([db.collection('materials').find(q).limit(15).project({ name: 1 }).toArray(), db.collection('materials').countDocuments(q)]);
      return { title: 'Позиции этого цвета', total, items: rows.map((r) => ({ label: s(r.name), href: '#stock?open=' + String(r._id) })) };
    },
    reassign: async (db, from, to) => (await db.collection('materials').updateMany({ colors: s(from.name) }, { $set: { 'colors.$': s(to.name) } })).modifiedCount,
    options: (docs) => docs.map((d) => s(d.name)),
  },

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
      workTypeId: d.workTypeId ? String(d.workTypeId) : '', payoutScheduleId: d.payoutScheduleId ? String(d.payoutScheduleId) : '',
      status: s(d.status) || 'active', statusLabel: ({ active: 'Работает', vacation: 'В отпуске', fired: 'Уволен' } as Record<string, string>)[s(d.status) || 'active'],
      salaryKind: s(d.salaryKind), salaryRate: d.salaryRate ?? null,
    }),
    toDoc: async (b, isNew) => {
      const doc: Document = { updatedAt: new Date() };
      for (const k of ['lastName', 'firstName', 'patronymic', 'position', 'phone', 'email', 'notes']) if (b[k] !== undefined) doc[k] = opt(b[k]);
      if (b.status !== undefined) doc.status = ['active', 'vacation', 'fired'].includes(String(b.status)) ? b.status : 'active';
      if (b.salaryKind !== undefined) doc.salaryKind = ['month', 'hour'].includes(String(b.salaryKind)) ? b.salaryKind : null;
      if (b.salaryRate !== undefined) { const n = Number(String(b.salaryRate ?? '').replace(/\s/g, '').replace(',', '.')); doc.salaryRate = Number.isFinite(n) && n > 0 ? n : null; }
      if (b.workTypeId !== undefined) doc.workTypeId = oidOrNull(b.workTypeId);
      if (b.payoutScheduleId !== undefined) doc.payoutScheduleId = oidOrNull(b.payoutScheduleId);
      if (isNew) Object.assign(doc, { status: doc.status ?? 'active', deletedAt: null, createdAt: new Date() });
      return doc;
    },
    usage: async (db, docs) => {
      const t = await tally(db, 'supplyrequests', 'requestedBy');
      return new Map(docs.map((d) => [String(d._id), Math.max(...personKeys(d).map((k) => t.get(k) ?? 0), 0)]));
    },
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
      const rows = await db.collection('persons').aggregate([{ $match: { deletedAt: null, workTypeId: { $in: docs.map((d) => d._id) } } }, { $group: { _id: '$workTypeId', n: { $sum: 1 } } }]).toArray();
      return new Map(rows.map((r) => [String(r._id), r.n as number]));
    },
    related: async (db, d) => {
      const rows = (await db.collection('persons').find({ deletedAt: null, workTypeId: d._id }).sort({ lastName: 1 }).limit(50).toArray()) as Doc[];
      return { title: 'Сотрудники', total: rows.length, items: rows.map((r) => ({ label: personName(r), sub: s(r.position), href: '#dicts?d=persons&of=dict&open=' + String(r._id) })) };
    },
    reassign: async (db, from, to) => (await db.collection('persons').updateMany({ workTypeId: from._id }, { $set: { workTypeId: to._id } })).modifiedCount,
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
  simpleList('services', 'Заявки и счета', 'Услуги', 'Услуги в счетах: доставка, погрузка, аренда техники…', [{ key: 'notes', label: 'Примечание' }], undefined, [], 'services'),

  // ───────── Паспорта (БЗ-6, docs/PASSPORTS-V2.md §2, §3.2, §3.3): правят директор и админ ─────────
  {
    ...simpleList('passportCategories', 'Паспорта', 'Категории паспортов',
      'Вид изделия для паспорта: какие разделы, нормативы, обязательные рисунки и значения по умолчанию. ALL — «Для всех»: его тексты получают все категории. Не путать с категориями каталога — связь в поле «Категории каталога».',
      [
        { key: 'code', label: 'Код', required: true, hint: 'ALL, DIO, DSP, TRN, WRK, MAF — латиницей; по нему тексты и шаблоны' },
        { key: 'catalogNames', label: 'Категории каталога', wide: true, hint: 'Через запятую, как в паспортах и каталоге: «Уличный тренажёр, Тренажёр уличный»' },
        { key: 'standards', label: 'Нормативы (коды)', wide: true, hint: 'Коды из «Нормативов» через запятую: GOST_R_57538' },
        { key: 'serviceLifeYears', label: 'Срок службы, лет' },
        { key: 'warrantyMonths', label: 'Гарантия, мес.' },
        { key: 'requiredFields', label: 'Обязательные поля', type: 'textarea', wide: true, hint: 'По строке ключ поля паспорта: ageFrom, ageTo, heightMin, heightMax, weightMax, maxUsers, fallHeight, siteLength, siteWidth, serviceLifeYears (можно «ключ — подпись»). Пусто — как в программе по умолчанию' },
        { key: 'requiredImages', label: 'Обязательные рисунки', type: 'textarea', wide: true, hint: 'По строке: overview, dimensions, safety_zone, foundation… (виды картинок паспорта)' },
        { key: 'extraSections', label: 'Разделы сверх общего', type: 'textarea', wide: true },
      ]),
    editRoles: ['director'],
  },
  {
    ...simpleList('passportStandards', 'Паспорта', 'Нормативы',
    'ГОСТ, ТР ЕАЭС, СП, на которые ссылается текст паспорта: в тексте — {std:КОД}, подставляется «Название». Статус и дата проверки — чтобы не ссылаться на отменённое (паспорт предупредит).',
    [
      { key: 'code', label: 'Код для текста', required: true, hint: 'Латиницей, без пробелов: GOST_R_52301 → в тексте {std:GOST_R_52301}' },
      { key: 'title', label: 'Полное наименование', wide: true },
      { key: 'status', label: 'Статус', type: 'select', options: ['действует', 'проверить', 'не обязателен', 'заменён', 'не применять'].map((v) => ({ value: v, label: v })) },
      { key: 'checkedAt', label: 'Проверено (дата)', hint: 'ГГГГ-ММ-ДД — когда сверяли по официальной базе' },
      { key: 'applies', label: 'Где применяем', wide: true },
    ]),
    editRoles: ['director'],
  },
  {
    ...simpleList('passportElements', 'Паспорта', 'Функциональные элементы',
      'Из чего состоит изделие по назначению (турник, брусья, горка…): фраза для описания, правила пользования и что проверять при ТО. Подставляются в текст паспорта по составу изделия.',
      [
        { key: 'code', label: 'Код', required: true, hint: 'Латиницей: HORIZONTAL_BAR' },
        { key: 'categories', label: 'Категории', wide: true, hint: 'Коды категорий через запятую: DIO, DSP, TRN, WRK, MAF' },
        { key: 'inDescription', label: 'В описании', wide: true, hint: 'Фраза для раздела «Описание», напр. «горизонтальная перекладина для подтягиваний»' },
        { key: 'purpose', label: 'Назначение', wide: true },
        { key: 'usageRules', label: 'Правила пользования', type: 'textarea', wide: true, hint: 'По строке на шаг' },
        { key: 'inspect', label: 'Что проверять при ТО', type: 'textarea', wide: true, hint: 'По строке на пункт' },
        { key: 'standard', label: 'Норматив (код)', hint: 'Код из «Нормативов»' },
      ]),
    editRoles: ['director'],
  },
  {
    ...simpleList('passportMaterials', 'Паспорта', 'Материалы и покрытия',
      'Материалы изделий: фраза «изготовлено из…», уход и ремонт, типичные дефекты. Подставляются в паспорт по материалам изделия.',
      [
        { key: 'code', label: 'Код', required: true, hint: 'Латиницей: STEEL_POWDER' },
        { key: 'madeOf', label: 'Изготовлено из…', wide: true, hint: 'В родительном падеже: «стальной трубы с порошковым покрытием»' },
        { key: 'care', label: 'Уход и ремонт', type: 'textarea', wide: true, hint: 'По строке на пункт' },
        { key: 'defects', label: 'Типичные дефекты (коды)', wide: true, hint: 'Коды из «Дефектов» через запятую' },
      ]),
    editRoles: ['director'],
  },
  {
    ...simpleList('passportDefects', 'Паспорта', 'Дефекты',
      'Типовые дефекты, которые ищут при осмотре, и что с ними делать. Попадают в таблицу «Дефект — мера — период» паспорта.',
      [
        { key: 'code', label: 'Код', required: true, hint: 'Латиницей: CORROSION' },
        { key: 'applies', label: 'Элементы и материалы (коды)', wide: true, hint: 'Через запятую' },
        { key: 'measure', label: 'Мера', wide: true, hint: 'Что делать при обнаружении' },
        { key: 'period', label: 'Период проверки', type: 'select', options: ['ежедневно', 'ежемесячно', 'ежеквартально', 'ежегодно'].map((v) => ({ value: v, label: v })) },
        { key: 'tolerance', label: 'Допуск', wide: true, hint: 'Что считается допустимым; число — только если оно общепринятое' },
        { key: 'photoId', label: 'Картинка', type: 'photo', hint: 'Миниатюра дефекта в таблице ТО паспорта; перетащите файл, вставьте Ctrl+V или выберите' },
      ]),
    editRoles: ['director'],
  },
  {
    ...simpleList('passportInstall', 'Паспорта', 'Способы установки',
      'Как изделие крепится на месте: текст монтажа, требования к основанию и какие рисунки обязательны.',
      [
        { key: 'code', label: 'Код', required: true, hint: 'Латиницей: CONCRETE_POSTS' },
        { key: 'montage', label: 'Текст монтажа', type: 'textarea', wide: true, hint: 'По строке на шаг' },
        { key: 'baseRequirements', label: 'Требования к основанию', type: 'textarea', wide: true, hint: 'По строке на пункт' },
        { key: 'requiredImages', label: 'Обязательные рисунки', type: 'textarea', wide: true, hint: 'По строке: foundation, holes…' },
        // Э9.5: стандартные схемы узлов — попадают в паспорт с этим способом установки, если у паспорта нет своих
        { key: 'schemesFoundation', label: 'Стандартные схемы: фундамент / опоры', type: 'photos', wide: true, hint: 'Разрез узла: покрытие, грунт, бетон, щебень, размеры' },
        { key: 'schemesHoles', label: 'Стандартные схемы: скважины / разметка', type: 'photos', wide: true, hint: 'План с расстояниями между опорами' },
        { key: 'schemesMounting', label: 'Стандартные схемы: монтаж', type: 'photos', wide: true },
      ]),
    editRoles: ['director'],
  },
  {
    ...simpleList('passportStyle', 'Паспорта', 'Оформление',
      'Как выглядит PDF паспорта: цвет категории, фон обложки, рамка и пиктограммы правил. Запись с «Использовать = нет» в PDF не попадает.',
      [
        { key: 'code', label: 'Код', required: true, hint: 'Латиницей: COVER_TRN, FRAME_ALL, ICON_NO_CLIMB' },
        { key: 'kind', label: 'Вид', type: 'select', options: ['цвет категории', 'фон обложки', 'рамка', 'пиктограмма правил'].map((v) => ({ value: v, label: v })) },
        { key: 'category', label: 'Категория (код)', hint: 'ALL, DIO, DSP, TRN, WRK, MAF или пусто' },
        { key: 'color', label: 'Цвет', type: 'color' },
        { key: 'photoId', label: 'Картинка', type: 'photo', hint: 'Пиктограмма или фон; перетащите файл, вставьте Ctrl+V или выберите' },
        { key: 'use', label: 'Использовать', type: 'select', options: ['да', 'нет'].map((v) => ({ value: v, label: v })) },
        { key: 'text', label: 'Подпись', wide: true, hint: 'Для пиктограммы правил; можно {maxUsers}' },
      ]),
    editRoles: ['director'],
  },
];

export const DICT = new Map(DICTS.map((d) => [d.key, d]));
