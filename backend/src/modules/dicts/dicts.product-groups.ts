import { BadRequestException, ConflictException } from '@nestjs/common';
import { Types } from 'mongoose';
import type { mongo } from 'mongoose';
import type { DictBase } from './dicts.defs';

type Db = mongo.Db;
const s = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();
const GROUP_NO_RE = /^\d{2}$/;
const isOid = (v: unknown) => Types.ObjectId.isValid(String(v ?? '')) && String(v).length === 24;
/** Живые группы изделий (внутри разделов) и сами разделы. */
const GROUPS = { type: 'product', deletedAt: null, parentId: { $ne: null } };
const SECTIONS = { type: 'product', deletedAt: null, parentId: null };

type Ctx = { translit: (t: string) => string };

/** slug и skuPrefix обязательны в схеме CRM (оба уникальны) — подбираем свободные. */
async function crmKeys(db: Db, name: string, translit: Ctx['translit']) {
  const base = translit(name) || 'product';
  let slug = base, i = 1;
  while (await db.collection('categories').findOne({ type: 'product', slug })) slug = `${base}-${++i}`;
  const pBase = base.replace(/-/g, '').slice(0, 3).toUpperCase() || 'PRD';
  let skuPrefix = pBase; i = 1;
  while (await db.collection('categories').findOne({ skuPrefix })) skuPrefix = `${pBase}${++i}`;
  return { slug, skuPrefix };
}

const countProducts = (db: Db, ids: unknown[]) => db.collection('products').aggregate([{ $match: { deletedAt: null, categoryId: { $in: ids } } }, { $group: { _id: '$categoryId', n: { $sum: 1 } } }]).toArray();

/**
 * «Группы изделий» и «Разделы изделий» (2026-10-25): живут в `categories` (type product), как их создаёт карточка изделия
 * (`showcase.ensureCategory`), но с номером группы `groupNo` — он даёт первые две цифры артикула. `groupNo` в схеме CRM нет —
 * пишется сырым `db.collection`. Номер уникален среди живых групп и после первой записи не меняется.
 */
export function productGroupDefs({ translit }: Ctx): DictBase[] {
  const groups: DictBase = {
    key: 'productGroups', group: 'Склад и позиции', title: 'Группы изделий',
    hint: 'Тренажёры, Воркаут, Скамьи… Номер группы — первые две цифры артикула изделия (группа 12 → артикулы 12…). Раздел собирает группы вместе.',
    coll: 'categories', match: GROUPS,
    columns: [{ key: 'groupNo', label: 'Номер' }, { key: 'parentName', label: 'Раздел' }],
    fields: [
      { key: 'name', label: 'Название', required: true, wide: true },
      { key: 'groupNo', label: 'Номер группы', required: true, lockAfterCreate: true, hint: 'Первые две цифры артикула изделий этой группы; менять нельзя — иначе путаница в артикулах' },
      { key: 'parentId', label: 'Раздел', type: 'select', ref: 'productSections', required: true, hint: 'Нет нужного раздела — сначала создайте его в «Разделах изделий»' },
    ],
    name: (d) => s(d.name),
    row: (d) => ({ name: s(d.name), groupNo: s(d.groupNo), parentId: d.parentId ? String(d.parentId) : '' }),
    toDoc: async (b, isNew, db, id) => {
      const name = s(b.name);
      if (!name) throw new BadRequestException('Укажите название группы');
      const cur = id ? await db.collection('categories').findOne({ _id: new Types.ObjectId(id) }) : null;
      // Дубль по названию — подсказываем пользователю до проверки номера
      const nameDup = await db.collection('categories').findOne(
        { ...GROUPS, name, ...(id ? { _id: { $ne: new Types.ObjectId(id) } } : {}) },
        { projection: { name: 1, groupNo: 1 } },
      );
      if (nameDup) throw new ConflictException(`Группа «${s(nameDup.name)}» уже существует${s(nameDup.groupNo) ? ` (№${s(nameDup.groupNo)})` : ''} — найдите её в списке.`);
      // раздел: не пришёл при правке — остаётся прежний
      let parentId: unknown = cur?.parentId ?? null;
      if (b.parentId !== undefined || isNew) {
        if (!isOid(b.parentId)) throw new BadRequestException('Выберите раздел');
        const sec = await db.collection('categories').findOne({ ...SECTIONS, _id: new Types.ObjectId(String(b.parentId)) });
        if (!sec) throw new BadRequestException('Раздел не найден — выберите из списка');
        parentId = sec._id;
      }
      // номер: две цифры, уникален среди живых групп; у группы с номером не меняется
      const had = s(cur?.groupNo);
      const raw = b.groupNo === undefined ? had : s(b.groupNo);
      if (!raw) throw new BadRequestException('Укажите номер группы — две цифры, например 12');
      if (!GROUP_NO_RE.test(raw)) throw new BadRequestException('Номер группы — ровно две цифры, например 12');
      if (had && raw !== had) throw new BadRequestException('Номер группы нельзя менять: он уже вошёл в артикулы изделий');
      const dup = await db.collection('categories').findOne({ ...GROUPS, groupNo: raw, ...(id ? { _id: { $ne: new Types.ObjectId(id) } } : {}) }, { projection: { name: 1 } });
      if (dup) throw new ConflictException(`Номер ${raw} уже занят группой «${s(dup.name)}»`);
      if (!isNew) return { name, parentId, groupNo: raw, updatedAt: new Date() };
      return { name, ...(await crmKeys(db, name, translit)), type: 'product', parentId, groupNo: raw, sortOrder: 0, isActive: true, deletedAt: null, createdAt: new Date(), updatedAt: new Date() };
    },
    beforeRemove: async (db, d) => {
      const n = await db.collection('products').countDocuments({ deletedAt: null, categoryId: d._id });
      if (n > 0) throw new ConflictException(`В группе «${s(d.name)}» есть изделия (${n}) — удалить нельзя. Перенесите их через «Объединить с…» в другую группу.`);
    },
    usage: async (db, docs) => new Map((await countProducts(db, docs.map((d) => d._id))).map((r) => [String(r._id), r.n as number])),
    related: async (db, d) => {
      const q = { deletedAt: null, categoryId: d._id };
      const [rows, total] = await Promise.all([db.collection('products').find(q).sort({ name: 1 }).limit(15).project({ name: 1, sku: 1 }).toArray(), db.collection('products').countDocuments(q)]);
      return { title: 'Изделия группы', total, items: rows.map((r) => ({ label: s(r.name), sub: s(r.sku), href: '#products?open=' + String(r._id) })) };
    },
    reassign: async (db, from, to) => (await db.collection('products').updateMany({ categoryId: from._id }, { $set: { categoryId: to._id } })).modifiedCount,
  };

  const sections: DictBase = {
    key: 'productSections', group: 'Склад и позиции', title: 'Разделы изделий',
    hint: 'Крупные разделы продукции: в них собираются группы изделий («Спорт» → Тренажёры, Воркаут).',
    coll: 'categories', match: SECTIONS,
    columns: [],
    fields: [{ key: 'name', label: 'Название', required: true, wide: true }],
    name: (d) => s(d.name),
    row: (d) => ({ name: s(d.name) }),
    toDoc: async (b, isNew, db) => {
      const name = s(b.name);
      if (!name) throw new BadRequestException('Укажите название раздела');
      if (!isNew) return { name, updatedAt: new Date() };
      return { name, ...(await crmKeys(db, name, translit)), type: 'product', parentId: null, sortOrder: 0, isActive: true, deletedAt: null, createdAt: new Date(), updatedAt: new Date() };
    },
    beforeRemove: async (db, d) => {
      const n = await db.collection('categories').countDocuments({ ...GROUPS, parentId: d._id });
      if (n > 0) throw new ConflictException(`В разделе «${s(d.name)}» есть группы (${n}) — удалить нельзя. Сначала перенесите группы в другой раздел.`);
    },
    usage: async (db, docs) => {
      const rows = await db.collection('categories').aggregate([{ $match: { ...GROUPS, parentId: { $in: docs.map((d) => d._id) } } }, { $group: { _id: '$parentId', n: { $sum: 1 } } }]).toArray();
      return new Map(rows.map((r) => [String(r._id), r.n as number]));
    },
    related: async (db, d) => {
      const q = { ...GROUPS, parentId: d._id };
      const [rows, total] = await Promise.all([db.collection('categories').find(q).sort({ name: 1 }).limit(15).project({ name: 1, groupNo: 1 }).toArray(), db.collection('categories').countDocuments(q)]);
      return { title: 'Группы раздела', total, items: rows.map((r) => ({ label: s(r.name), sub: r.groupNo ? `№ ${s(r.groupNo)}` : '', href: '#dicts?d=productGroups&of=dict&open=' + String(r._id) })) };
    },
    reassign: async (db, from, to) => (await db.collection('categories').updateMany({ ...GROUPS, parentId: from._id }, { $set: { parentId: to._id } })).modifiedCount,
  };
  return [groups, sections];
}
