import { BadRequestException, Injectable } from '@nestjs/common';
import { costCenterLabel } from '../supply/cost-center';
import { InjectConnection } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import { Types } from 'mongoose';
import { ourCompanies } from '../incomes/incomes.service';
import { buildCashflow, buildSummary, type Op } from './cashflow';
import { buildForecast, expectedOps, type ExpenseSrc, type IncomeSrc } from './forecast';

const iso = (d: unknown) => (d instanceof Date && !Number.isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : '');
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Деньги: платёжный календарь и сводка — расчёт на лету, отдельных таблиц нет (TASKS Ф.5).
 *  Расход  = заявка снабжения с датой счёта (invoiceDate), суммой (priceHint — сумма строки с НДС) и нашей компанией; отменённые не считаются.
 *  Доход   = строка заказа (incomes) с суммой (amount) и датой в отчёт (reportDate = оплата ?? отгрузка).
 *  Без суммы, даты или компании — в расчёт не идёт, попадает в «требуют заполнения».
 */
@Injectable()
export class FinanceService {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  private period(q: Record<string, unknown>) {
    const now = new Date();
    const from = String(q.from || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`);
    const to = String(q.to || iso(new Date(Date.UTC(now.getFullYear(), now.getMonth() + 1, 0))));
    if (!DAY.test(from) || !DAY.test(to)) throw new BadRequestException('Период: from и to в формате ГГГГ-ММ-ДД');
    if (from > to) throw new BadRequestException('Начало периода позже конца');
    if (Date.parse(to) - Date.parse(from) > 366 * 86400000) throw new BadRequestException('Период — не больше года');
    return { from, to };
  }

  /** org: all | название (СИЮ) | id → список наших компаний для расчёта. */
  private async companies(org: unknown) {
    const all = await ourCompanies(this.connection);
    const o = String(org ?? 'all').trim();
    if (!o || o === 'all') return { all, used: all };
    const used = all.filter((c) => String(c.id) === o || c.name.toLowerCase() === o.toLowerCase() || c.full.toLowerCase() === o.toLowerCase());
    if (!used.length) throw new BadRequestException(`Компания «${o}» не найдена (наши: ${all.map((c) => c.name).join(', ')})`);
    return { all, used };
  }

  /** Операции периода по выбранным компаниям. */
  private async ops(from: string, to: string, companyIds: Types.ObjectId[]): Promise<Op[]> {
    const db = this.connection.db!;
    const range = { $gte: new Date(from + 'T00:00:00Z'), $lt: new Date(Date.parse(to + 'T00:00:00Z') + 86400000) };
    const companies = await ourCompanies(this.connection);
    const cname = new Map(companies.map((c) => [String(c.id), c.name]));
    const [reqs, incs, cats, orgs] = await Promise.all([
      db.collection('supplyrequests').find({ deletedAt: null, status: { $ne: 'cancelled' }, invoiceDate: range, priceHint: { $gt: 0 }, companyId: { $in: companyIds } },
        { projection: { num: 1, title: 1, priceHint: 1, invoiceDate: 1, invoiceNo: 1, companyId: 1, categoryId: 1, supplierId: 1, costCenter: 1, salesOrderId: 1, photoIds: 1 } }).toArray(),
      db.collection('incomes').find({ deletedAt: null, reportDate: range, amount: { $gt: 0 }, companyId: { $in: companyIds } },
        { projection: { orderNo: 1, title: 1, amount: 1, reportDate: 1, companyId: 1, customer: 1 } }).toArray(),
      db.collection('categories').find({}, { projection: { name: 1 } }).toArray(),
      db.collection('organizations').find({}, { projection: { name: 1, shortName: 1 } }).toArray(),
    ]);
    const cat = new Map(cats.map((c) => [String(c._id), String(c.name)]));
    const org = new Map(orgs.map((o) => [String(o._id), String(o.shortName || o.name)]));
    const reqsWithPhoto = reqs.filter((r) => Array.isArray(r.photoIds) && (r.photoIds as unknown[]).length > 0);
    const thumbMap = new Map<string, string>();
    if (reqsWithPhoto.length > 0) {
      const firstIds = reqsWithPhoto.map((r) => (r.photoIds as Types.ObjectId[])[0]);
      const [thumbs, originals] = await Promise.all([
        db.collection('photos').find({ parentPhotoId: { $in: firstIds }, variant: 'thumb' }, { projection: { storageUrl: 1, parentPhotoId: 1 } }).toArray(),
        db.collection('photos').find({ _id: { $in: firstIds } }, { projection: { storageUrl: 1 } }).toArray(),
      ]);
      const byParent = new Map(thumbs.map((t) => [String(t.parentPhotoId), String(t.storageUrl)]));
      const byId = new Map(originals.map((p) => [String(p._id), String(p.storageUrl)]));
      for (const r of reqsWithPhoto) {
        const pid = String((r.photoIds as Types.ObjectId[])[0]);
        const url = byParent.get(pid) ?? byId.get(pid);
        if (url) thumbMap.set(String(r._id), url);
      }
    }
    return [
      ...reqs.map((r): Op => ({ type: 'expense', id: String(r._id), date: iso(r.invoiceDate), amount: Number(r.priceHint), company: cname.get(String(r.companyId)) ?? '?',
        title: (r.num ? `№${r.num} · ` : '') + String(r.title ?? ''), doc: r.invoiceNo ? String(r.invoiceNo) : undefined,
        category: r.categoryId ? cat.get(String(r.categoryId)) : undefined, counterparty: r.supplierId ? org.get(String(r.supplierId)) : undefined, costCenter: costCenterLabel(r as { costCenter?: unknown; salesOrderId?: unknown }),
        ...(thumbMap.has(String(r._id)) ? { thumb: thumbMap.get(String(r._id)) } : {}) })),
      ...incs.map((i): Op => ({ type: 'income', id: String(i._id), date: iso(i.reportDate), amount: Number(i.amount), company: cname.get(String(i.companyId)) ?? '?',
        title: String(i.title ?? ''), doc: i.orderNo ? `заказ ${i.orderNo}` : undefined, counterparty: i.customer ? String(i.customer) : undefined })),
    ];
  }

  /** Что мешает посчитать: заявки с датой счёта без суммы и т.п., доходы без суммы/даты/компании. */
  async needsFill(limit = 300) {
    const db = this.connection.db!;
    const ours = (await ourCompanies(this.connection)).map((c) => c.id);
    const noCompany = { $or: [{ companyId: null }, { companyId: { $exists: false } }, { companyId: { $nin: ours } }] };
    const [reqs, incs] = await Promise.all([
      db.collection('supplyrequests').find({ deletedAt: null, status: { $ne: 'cancelled' }, $or: [
        { invoiceDate: { $ne: null }, $or: [{ priceHint: null }, { priceHint: { $exists: false } }, { priceHint: { $lte: 0 } }] },
        { priceHint: { $gt: 0 }, $or: [{ invoiceDate: null }, { invoiceDate: { $exists: false } }] },
        { invoiceDate: { $ne: null }, priceHint: { $gt: 0 }, ...noCompany },
      ] }, { projection: { num: 1, title: 1, priceHint: 1, invoiceDate: 1, invoiceNo: 1, companyId: 1 } }).sort({ invoiceDate: -1, num: -1 }).limit(limit).toArray(),
      db.collection('incomes').find({ deletedAt: null, $or: [{ amount: { $lte: 0 } }, { reportDate: null }, { reportDate: { $exists: false } }, ...noCompany.$or] },
        { projection: { orderNo: 1, title: 1, amount: 1, reportDate: 1, companyId: 1 } }).limit(limit).toArray(),
    ]);
    const has = (id: unknown) => !!id && ours.some((o) => String(o) === String(id));
    const items = [
      ...reqs.map((r) => ({ type: 'expense' as const, id: String(r._id), title: (r.num ? `№${r.num} · ` : '') + String(r.title ?? ''), doc: r.invoiceNo ? String(r.invoiceNo) : null, date: iso(r.invoiceDate) || null,
        missing: [!(Number(r.priceHint) > 0) && 'сумма', !r.invoiceDate && 'дата счёта', !has(r.companyId) && 'наша компания'].filter(Boolean) as string[] })),
      ...incs.map((i) => ({ type: 'income' as const, id: String(i._id), title: String(i.title ?? ''), doc: i.orderNo ? `заказ ${i.orderNo}` : null, date: iso(i.reportDate) || null,
        missing: [!(Number(i.amount) > 0) && 'сумма (кол-во × цена или вручную)', !i.reportDate && 'дата отгрузки или оплаты', !has(i.companyId) && 'наша компания'].filter(Boolean) as string[] })),
    ];
    return { total: items.length, items };
  }

  async cashflow(q: Record<string, unknown>) {
    const { from, to } = this.period(q);
    const opening = q.opening === undefined || q.opening === '' ? 0 : Number(String(q.opening).replace(',', '.'));
    if (!Number.isFinite(opening)) throw new BadRequestException('Начальный остаток — число');
    const { used } = await this.companies(q.org);
    const names = used.map((c) => c.name);
    const ops = await this.ops(from, to, used.map((c) => c.id));
    const { days, totals } = buildCashflow(ops, from, to, opening, names);
    return { from, to, org: q.org || 'all', companies: names, opening, days, totals, needsFill: await this.needsFill() };
  }

  /**
   * Прогноз (TASKS БЗ-1): с сегодня на days дней вперёд (7–180, по умолч. 30), остаток на сегодня — opening.
   * Только будущее и «без срока»: то, что уже попало в факт (счёт по сегодня, отгружено по сегодня), сюда не входит.
   */
  async forecast(q: Record<string, unknown>) {
    const days = q.days === undefined || q.days === '' ? 30 : Number(q.days);
    if (!Number.isInteger(days) || days < 7 || days > 180) throw new BadRequestException('Горизонт прогноза — от 7 до 180 дней');
    const opening = q.opening === undefined || q.opening === '' ? 0 : Number(String(q.opening).replace(',', '.'));
    if (!Number.isFinite(opening)) throw new BadRequestException('Остаток на сегодня — число');
    const today = String(q.today && DAY.test(String(q.today)) ? q.today : iso(new Date()));
    const to = iso(new Date(Date.parse(today + 'T00:00:00Z') + (days - 1) * 86400000));
    const { used } = await this.companies(q.org);
    const names = used.map((c) => c.name);
    const ids = used.map((c) => c.id);
    const cname = new Map(used.map((c) => [String(c.id), c.name]));
    const db = this.connection.db!;
    const endOfToday = new Date(Date.parse(today + 'T00:00:00Z') + 86400000);
    const [reqs, incs, orgs] = await Promise.all([
      db.collection('supplyrequests').find({ deletedAt: null, status: { $ne: 'cancelled' }, priceHint: { $gt: 0 }, companyId: { $in: ids },
        $or: [{ invoiceDate: { $gte: endOfToday } }, { invoiceDate: null, status: { $in: ['in_progress', 'requested', 'ordered'] } }, { invoiceDate: { $exists: false }, status: { $in: ['in_progress', 'requested', 'ordered'] } }] },
      { projection: { num: 1, title: 1, priceHint: 1, invoiceDate: 1, invoiceNo: 1, companyId: 1, supplierId: 1, status: 1 } }).toArray(),
      db.collection('incomes').find({ deletedAt: null, amount: { $gt: 0 }, companyId: { $in: ids }, $and: [{ $or: [{ paidDate: null }, { paidDate: { $exists: false } }] }, { $or: [{ reportDate: null }, { reportDate: { $exists: false } }, { reportDate: { $gte: endOfToday } }] }] },
      { projection: { title: 1, amount: 1, companyId: 1, paymentForm: 1, shipDate: 1, orderId: 1, orderNo: 1, customer: 1, createdAt: 1 } }).toArray(),
      db.collection('organizations').find({}, { projection: { name: 1, shortName: 1 } }).toArray(),
    ]);
    const orders = await db.collection('salesorders').find({ _id: { $in: incs.map((i) => i.orderId).filter(Boolean) } },
      { projection: { stage: 1, deletedAt: 1, contractDate: 1, createdAt: 1, shipDate: 1, productionDeadline: 1, deliveryDeadline: 1, paymentForm: 1 } }).toArray();
    const ord = new Map(orders.map((o) => [String(o._id), o]));
    const org = new Map(orgs.map((o) => [String(o._id), String(o.shortName || o.name)]));
    const expenses: ExpenseSrc[] = reqs.map((r) => ({ id: String(r._id), title: (r.num ? `№${r.num} · ` : '') + String(r.title ?? ''), amount: Number(r.priceHint), company: cname.get(String(r.companyId)) ?? '?',
      invoiceDate: iso(r.invoiceDate) || null, status: String(r.status), doc: r.invoiceNo ? String(r.invoiceNo) : undefined, counterparty: r.supplierId ? org.get(String(r.supplierId)) : undefined }));
    const incomes: IncomeSrc[] = incs.flatMap((i) => {
      const o = i.orderId ? ord.get(String(i.orderId)) : undefined;
      if (o && (o.deletedAt || o.stage === 'cancelled')) return [];
      return [{ id: String(i._id), title: String(i.title ?? ''), amount: Number(i.amount), company: cname.get(String(i.companyId)) ?? '?', paymentForm: (i.paymentForm ?? o?.paymentForm) as string | undefined,
        orderNo: i.orderNo ? String(i.orderNo) : undefined, customer: i.customer ? String(i.customer) : undefined,
        orderDate: iso(o?.contractDate) || iso(o?.createdAt) || iso(i.createdAt) || null,
        due: iso(i.shipDate) || iso(o?.shipDate) || iso(o?.productionDeadline) || iso(o?.deliveryDeadline) || null }];
    });
    const { ops, noDate } = expectedOps(expenses, incomes, today);
    const f = buildForecast(ops, today, to, opening, names);
    const sum = (t: string) => Math.round(noDate.filter((x) => x.type === t).reduce((s, x) => s + x.amount, 0) * 100) / 100;
    return { from: today, to, days: f.days, totals: f.totals, companies: names, opening, gapDays: f.gapDays, firstGap: f.firstGap, minBalance: f.minBalance, week: f.week,
      noDate: { items: noDate, expense: sum('expense'), income: sum('income') } };
  }

  async summary(q: Record<string, unknown>) {
    const { from, to } = this.period(q);
    const { used } = await this.companies(q.org);
    const names = used.map((c) => c.name);
    return { from, to, companies: names, ...buildSummary(await this.ops(from, to, used.map((c) => c.id)), from, to, names) };
  }
}
