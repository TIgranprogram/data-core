import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import type { mongo } from 'mongoose';
import type { DictBase } from './dicts.defs';

type Db = mongo.Db;
const s = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();
const isOid = (v: unknown) => Types.ObjectId.isValid(String(v ?? '')) && String(v).length === 24;
const key = (d: Record<string, unknown>) => `${d.parentId ? String(d.parentId) : ''}|${s(d.name).toLowerCase().replace(/ё/g, 'е')}`;

/** Статьи, заявки и прочие расходы, где записана подстатья. */
const usedBy = (db: Db, ids: unknown[]) => Promise.all(['supplyrequests', 'expenses'].map((c) => db.collection(c).aggregate([{ $match: { deletedAt: null, articleId: { $in: ids } } }, { $group: { _id: '$articleId', n: { $sum: 1 } } }]).toArray()));

/**
 * «Статьи расходов» (C027): два уровня в одной коллекции `expensearticles` — статья (`parentId` пусто) и подстатья.
 * Подстатья может быть привязана к категориям склада (`categoryIds`): заявка такой категории получает эту статью сама.
 * Подстатья с кодом (ФОТ) встроена в программу — её не удалить, но можно переименовать.
 */
export function expenseArticlesDef(): DictBase {
  return {
    key: 'expenseArticles', group: 'Деньги', title: 'Статьи расходов',
    hint: 'Куда уходят деньги: статья → подстатья. По ним строится «Деньги → По статьям». Подстатью можно привязать к категориям склада — заявка такой категории получит статью сама.',
    coll: 'expensearticles', match: { deletedAt: null },
    columns: [{ key: 'parentName', label: 'Статья' }, { key: 'categoryNames', label: 'Категории склада' }],
    fields: [
      { key: 'name', label: 'Название', required: true, wide: true },
      { key: 'parentId', label: 'Статья', type: 'select', ref: 'expenseArticles', refMatch: { parentId: null }, hint: 'К какой статье относится подстатья. Пусто — это сама статья (верхний уровень)' },
      { key: 'categoryIds', label: 'Категории склада', wide: true, type: 'select', ref: 'categories', multi: true, hint: 'Только для подстатьи: заявки этих категорий получат её как статью расхода' },
    ],
    name: (d) => s(d.name),
    row: (d) => ({ name: s(d.name), parentId: d.parentId ? String(d.parentId) : '', categoryIds: ((d.categoryIds as unknown[] | undefined) ?? []).map(String) }),
    dupKey: key,
    toDoc: async (b, isNew, db, id) => {
      const name = s(b.name);
      if (!name) throw new BadRequestException('Укажите название');
      const coll = db.collection('expensearticles');
      const cur = id ? await coll.findOne({ _id: new Types.ObjectId(id) }) : null;
      // уровень: пришёл — проверяем; не пришёл при правке — прежний
      let parentId: Types.ObjectId | null = cur?.parentId ?? null;
      if (b.parentId !== undefined || isNew) {
        const raw = s(b.parentId);
        if (!raw) parentId = null;
        else {
          if (!isOid(raw)) throw new BadRequestException('Выберите статью из списка');
          if (id && raw === id) throw new BadRequestException('Статья не может входить сама в себя');
          const p = await coll.findOne({ _id: new Types.ObjectId(raw), deletedAt: null, parentId: null });
          if (!p) throw new BadRequestException('Выберите статью верхнего уровня');
          parentId = p._id as Types.ObjectId;
        }
      }
      if (cur && cur.code && String(cur.parentId ?? '') !== String(parentId ?? '')) throw new BadRequestException('Эта подстатья встроена в программу — перенести её в другую статью нельзя');
      if (cur && parentId && !cur.parentId && (await coll.countDocuments({ parentId: cur._id, deletedAt: null }))) throw new BadRequestException('У статьи есть подстатьи — сначала перенесите их, потом делайте её подстатьёй');
      // категории склада — только у подстатьи, только существующие
      let categoryIds: Types.ObjectId[] = ((cur?.categoryIds as Types.ObjectId[] | undefined) ?? []);
      if (b.categoryIds !== undefined) {
        const list = [...new Set((Array.isArray(b.categoryIds) ? b.categoryIds : s(b.categoryIds).split(',')).map(s).filter(Boolean))];
        if (list.some((x) => !isOid(x))) throw new BadRequestException('Категория склада — выберите из списка');
        const ids = list.map((x) => new Types.ObjectId(x));
        if (ids.length && (await db.collection('categories').countDocuments({ _id: { $in: ids } })) !== ids.length) throw new BadRequestException('Категория склада не найдена — выберите из списка');
        categoryIds = ids;
      }
      if (!parentId) categoryIds = [];
      if (!isNew) return { name, parentId, categoryIds, updatedAt: new Date() };
      const last = await coll.find({ parentId, deletedAt: null }).sort({ sortOrder: -1 }).limit(1).toArray();
      return { name, parentId, sortOrder: (Number(last[0]?.sortOrder) || 0) + 10, categoryIds, deletedAt: null, createdAt: new Date(), updatedAt: new Date() };
    },
    beforeRemove: async (db, d) => {
      if (d.parentId) return;
      if (await db.collection('expensearticles').countDocuments({ parentId: d._id, deletedAt: null })) throw new BadRequestException('У статьи есть подстатьи — сначала удалите или перенесите их');
    },
    usage: async (db, docs) => {
      const m = new Map<string, number>();
      for (const r of (await usedBy(db, docs.map((d) => d._id))).flat()) m.set(String(r._id), (m.get(String(r._id)) ?? 0) + (r.n as number));
      return m;
    },
    related: async (db, d) => {
      const q = { deletedAt: null, articleId: d._id };
      const [reqs, exps, nReq, nExp] = await Promise.all([
        db.collection('supplyrequests').find(q).sort({ _id: -1 }).limit(10).project({ num: 1, title: 1 }).toArray(),
        db.collection('expenses').find(q).sort({ date: -1 }).limit(10).project({ title: 1, amount: 1 }).toArray(),
        db.collection('supplyrequests').countDocuments(q), db.collection('expenses').countDocuments(q),
      ]);
      return { title: 'Заявки со статьёй', total: nReq, items: reqs.map((r) => ({ label: `${r.num ? '№' + r.num + ' · ' : ''}${s(r.title)}`, href: '#requests?open=' + String(r._id) })),
        more: [{ title: 'Прочие расходы', total: nExp, items: exps.map((e) => ({ label: s(e.title), sub: Number(e.amount) > 0 ? `${Number(e.amount).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} ₽` : '', href: '#expenses?open=' + String(e._id) })) }] };
    },
    reassign: async (db, from, to) => {
      // подстатья → на другую подстатью; статья → на другую статью (переезжают её подстатьи)
      if (Boolean(from.parentId) !== Boolean(to.parentId)) throw new BadRequestException(from.parentId ? 'Заменить подстатью можно только на другую подстатью' : 'Заменить статью можно только на другую статью');
      if (!from.parentId) return (await db.collection('expensearticles').updateMany({ parentId: from._id, deletedAt: null }, { $set: { parentId: to._id, updatedAt: new Date() } })).modifiedCount;
      const [a, b] = await Promise.all([
        db.collection('supplyrequests').updateMany({ articleId: from._id }, { $set: { articleId: to._id, editedInApp: true } }),
        db.collection('expenses').updateMany({ articleId: from._id }, { $set: { articleId: to._id, updatedAt: new Date() } }),
      ]);
      return a.modifiedCount + b.modifiedCount;
    },
  };
}
