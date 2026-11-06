import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import { Types } from 'mongoose';
import { dateRange, oid, parseList } from '../../common/list-query';
import { ourCompanies } from '../incomes/incomes.service';
import { cleanText, parseAmount, parseDay } from './expense-rules';
import type { CreateExpenseDto, UpdateExpenseDto } from './dto/expense.dto';

const COLL = 'expenses';
const iso = (d: unknown) => (d instanceof Date && !Number.isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : '');
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Прочие расходы: запись факта оплаты со статьёй, фирмой, объектом и файлами счёта. */
@Injectable()
export class ExpensesService {
  constructor(@InjectConnection() private readonly connection: Connection) {}
  private get db() { return this.connection.db!; }

  /** Поля тела → документ (partial: только пришедшие). Проверяет фирму, подстатью, заказ и файлы. */
  async fields(b: CreateExpenseDto | UpdateExpenseDto, partial: boolean): Promise<Record<string, unknown>> {
    const f: Record<string, unknown> = {};
    if (!partial || b.date !== undefined) f.date = parseDay(b.date);
    if (!partial || b.amount !== undefined) f.amount = parseAmount(b.amount);
    if (!partial || b.title !== undefined) {
      const t = cleanText(b.title);
      if (!t) throw new BadRequestException('Укажите название');
      f.title = t;
    }
    if (!partial || b.companyId !== undefined) {
      if (!b.companyId || !Types.ObjectId.isValid(b.companyId)) throw new BadRequestException('Выберите фирму');
      const ours = await ourCompanies(this.connection);
      if (!ours.some((c) => String(c.id) === String(b.companyId))) throw new BadRequestException('Выберите нашу фирму из списка');
      f.companyId = new Types.ObjectId(b.companyId);
    }
    if (!partial || b.articleId !== undefined) {
      if (!b.articleId || !Types.ObjectId.isValid(b.articleId)) throw new BadRequestException('Выберите статью');
      const a = await this.db.collection('expensearticles').findOne({ _id: new Types.ObjectId(b.articleId), deletedAt: null }, { projection: { parentId: 1 } });
      if (!a) throw new BadRequestException('Статья не найдена — выберите из списка');
      if (!a.parentId) throw new BadRequestException('Выберите подстатью, а не общую статью');
      f.articleId = a._id;
    }
    if (b.salesOrderId !== undefined) {
      if (!b.salesOrderId) f.salesOrderId = null;
      else {
        if (!Types.ObjectId.isValid(b.salesOrderId)) throw new BadRequestException('Объект не найден — выберите заказ из списка');
        const o = await this.db.collection('salesorders').findOne({ _id: new Types.ObjectId(b.salesOrderId), deletedAt: null }, { projection: { _id: 1 } });
        if (!o) throw new BadRequestException('Заказ не найден — выберите из списка');
        f.salesOrderId = o._id;
      }
    }
    for (const k of ['counterpartyName', 'docNo', 'comment'] as const) if (b[k] !== undefined) f[k] = cleanText(b[k]) || null;
    if (b.fileIds !== undefined) {
      const ids = [...new Set(b.fileIds.map(String))].map((i) => oid(i, 'файла'));
      if (ids.length && (await this.db.collection('photos').countDocuments({ _id: { $in: ids } })) !== ids.length) throw new NotFoundException('Файл не найден — загрузите ещё раз');
      f.fileIds = ids;
    }
    return f;
  }

  async list(q: Record<string, unknown>) {
    const p = parseList(q, { sortable: ['date', 'amount', 'createdAt'], defaultSort: '-date', defaultLimit: 50 });
    const filter: Record<string, unknown> = { deletedAt: null };
    const range = dateRange(q.from, q.to);
    if (range) filter.date = range;
    if (q.companyId) filter.companyId = oid(q.companyId, 'фирмы');
    if (q.articleId) {
      // выбрана статья верхнего уровня — берём все её подстатьи
      const id = oid(q.articleId, 'статьи');
      const a = await this.db.collection('expensearticles').find({ deletedAt: null, $or: [{ _id: id }, { parentId: id }] }, { projection: { _id: 1 } }).toArray();
      filter.articleId = { $in: a.map((x) => x._id) };
    }
    if (q.salesOrderId) filter.salesOrderId = oid(q.salesOrderId, 'заказа');
    if (p.search) filter.$or = [{ title: p.search }, { counterpartyName: p.search }, { docNo: p.search }];
    const coll = this.db.collection(COLL);
    const [docs, total, sums] = await Promise.all([coll.find(filter).sort({ ...p.sort, _id: -1 }).skip(p.skip).limit(p.limit).toArray(), coll.countDocuments(filter),
      coll.aggregate([{ $match: filter }, { $group: { _id: null, sum: { $sum: '$amount' } } }]).toArray()]);
    // sum — по всему фильтру, не только по странице
    return { items: await this.present(docs), total, page: p.page, limit: p.limit, sum: Math.round((Number(sums[0]?.sum) || 0) * 100) / 100 };
  }

  async get(id: string) {
    const d = await this.db.collection(COLL).findOne({ _id: oid(id, 'расхода'), deletedAt: null });
    if (!d) throw new NotFoundException('Расход не найден');
    return (await this.present([d]))[0];
  }

  async create(b: CreateExpenseDto, userId?: string) {
    const now = new Date();
    const f = await this.fields(b, false);
    const doc = { fileIds: [], ...f, ...(userId && Types.ObjectId.isValid(userId) ? { createdBy: new Types.ObjectId(userId) } : {}), deletedAt: null, createdAt: now, updatedAt: now };
    const r = await this.db.collection(COLL).insertOne(doc);
    return this.get(String(r.insertedId));
  }

  async update(id: string, b: UpdateExpenseDto) {
    const f = await this.fields(b, true);
    const res = await this.db.collection(COLL).updateOne({ _id: oid(id, 'расхода'), deletedAt: null }, { $set: { ...f, updatedAt: new Date() } });
    if (!res.matchedCount) throw new NotFoundException('Расход не найден');
    return this.get(id);
  }

  async remove(id: string) {
    const res = await this.db.collection(COLL).updateOne({ _id: oid(id, 'расхода'), deletedAt: null }, { $set: { deletedAt: new Date(), updatedAt: new Date() } });
    if (!res.matchedCount) throw new NotFoundException('Расход не найден');
    return { id, deleted: true };
  }

  /** Названия статьи/фирмы/заказа и файлы — для строк списка. */
  private async present(docs: Row[]) {
    const db = this.db;
    const ids = (k: string) => [...new Set(docs.map((d) => d[k]).filter(Boolean).map(String))].map((x) => new Types.ObjectId(x));
    const fileIds = [...new Set(docs.flatMap((d) => (d.fileIds ?? []).map(String)))].map((x) => new Types.ObjectId(x));
    const [arts, comps, orders, files] = await Promise.all([
      db.collection('expensearticles').find({ _id: { $in: ids('articleId') } }, { projection: { name: 1, parentId: 1 } }).toArray(),
      ourCompanies(this.connection, { withOffersOnly: true }),
      db.collection('salesorders').find({ _id: { $in: ids('salesOrderId') } }, { projection: { orderNo: 1 } }).toArray(),
      fileIds.length ? db.collection('photos').find({ _id: { $in: fileIds } }, { projection: { storageUrl: 1, originalName: 1, originalFilename: 1, name: 1 } }).toArray() : [],
    ]);
    const parents = await db.collection('expensearticles').find({ _id: { $in: arts.map((a) => a.parentId).filter(Boolean) } }, { projection: { name: 1 } }).toArray();
    const art = new Map(arts.map((a) => [String(a._id), a]));
    const par = new Map(parents.map((a) => [String(a._id), String(a.name)]));
    const comp = new Map(comps.map((c) => [String(c.id), c.name]));
    const ord = new Map(orders.map((o) => [String(o._id), String(o.orderNo ?? '')]));
    const fl = new Map(files.map((p) => [String(p._id), { id: String(p._id), name: String(p.originalFilename ?? p.originalName ?? p.name ?? 'Файл'), url: String(p.storageUrl) }]));
    return docs.map((d) => {
      const a = art.get(String(d.articleId));
      return {
        ...d, id: String(d._id), _id: String(d._id), date: iso(d.date),
        companyId: String(d.companyId), articleId: String(d.articleId), salesOrderId: d.salesOrderId ? String(d.salesOrderId) : null,
        fileIds: (d.fileIds ?? []).map(String),
        articleName: a ? String(a.name) : null, parentArticleName: a?.parentId ? par.get(String(a.parentId)) ?? null : null,
        companyName: comp.get(String(d.companyId)) ?? null, salesOrderNo: d.salesOrderId ? ord.get(String(d.salesOrderId)) || null : null,
        files: (d.fileIds ?? []).map((f: unknown) => fl.get(String(f))).filter(Boolean),
      };
    });
  }
}
