import { BadRequestException, Injectable } from '@nestjs/common';
import { costCenterLabel } from '../supply/cost-center';
import { InjectConnection } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import { Types } from 'mongoose';
import { ourCompanies } from '../incomes/incomes.service';
import { buildCashflow, buildPending, buildSummary, openingFromStart, type Op, type Start } from './cashflow';
import { incomePayments, type IncomePayment } from '../incomes/income.schema';
import { PayrollService } from '../payroll/payroll.service';
import { firstPhotoThumbs } from '../../common/photo-thumbs';
import { buildForecast, expectedOps, type ExpenseSrc, type IncomeSrc } from './forecast';

const iso = (d: unknown) => (d instanceof Date && !Number.isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : '');
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Деньги: платёжный календарь и сводка — расчёт на лету, отдельных таблиц нет (TASKS Ф.5).
 *  Расход  = ОПЛАЧЕННАЯ заявка снабжения (paid) в день оплаты (paidAt, нет — дата счёта), сумма priceHint (с НДС, без пересчёта — В-5), наша компания;
 *            плюс выплаты ФОТ (payroll_payments). Неоплаченные счета — отдельно, `pending.invoices` (В-1).
 *  Доход   = ПЛАТЁЖ по позиции заказа (incomes.payments; старая запись с paidDate = один платёж) в день платежа.
 *            Отгружено, но не оплачено — отдельно, `pending.awaiting` (В-2).
 *  Без суммы, даты или компании — в расчёт не идёт, попадает в «требуют заполнения».
 */
@Injectable()
export class FinanceService {
  constructor(@InjectConnection() private readonly connection: Connection, private readonly payroll: PayrollService) {}

  private period(q: Record<string, unknown>) {
    const now = new Date();
    const from = String(q.from || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`);
    const to = String(q.to || iso(new Date(Date.UTC(now.getFullYear(), now.getMonth() + 1, 0))));
    if (!DAY.test(from) || !DAY.test(to)) throw new BadRequestException('Период: from и to в формате ГГГГ-ММ-ДД');
    if (from > to) throw new BadRequestException('Начало периода позже конца');
    if (Date.parse(to) - Date.parse(from) > 366 * 86400000) throw new BadRequestException('Период — не больше года');
    return { from, to };
  }

  /** Настройка «Старт учёта» (одна запись): дата и остатки по нашим компаниям. */
  async settings() {
    const d = await this.connection.db!.collection('finance_settings').findOne({ key: 'finance' });
    const cs = await ourCompanies(this.connection);
    const bal = (d?.openingBalance ?? {}) as Record<string, number>;
    return { startDate: d?.startDate ? String(d.startDate) : null, openingBalance: Object.fromEntries(cs.map((c) => [c.name, Number(bal[c.name]) || 0])), companies: cs.map((c) => c.name) };
  }

  async saveSettings(b: { startDate?: string | null; openingBalance?: Record<string, number> }) {
    if (b.startDate && !DAY.test(b.startDate)) throw new BadRequestException('Дата старта — ГГГГ-ММ-ДД');
    if (b.startDate && b.startDate > new Date().toISOString().slice(0, 10)) throw new BadRequestException('Дата старта не может быть в будущем');
    const names = (await ourCompanies(this.connection)).map((c) => c.name);
    const ob: Record<string, number> = {};
    for (const [k, v] of Object.entries(b.openingBalance ?? {})) {
      if (!names.includes(k)) throw new BadRequestException(`Компания «${k}» не найдена (наши: ${names.join(', ')})`);
      const n = Number(v);
      if (!Number.isFinite(n)) throw new BadRequestException('Остаток — число');
      ob[k] = n;
    }
    await this.connection.db!.collection('finance_settings').updateOne({ key: 'finance' }, { $set: { key: 'finance', startDate: b.startDate || null, openingBalance: ob, updatedAt: new Date() } }, { upsert: true });
    return this.settings();
  }

  /** Старт учёта для выбранных компаний (нет настроек или даты — null: считаем как раньше, от остатка из запроса). */
  private async start(names: string[]): Promise<Start | null> {
    const s = await this.settings();
    return s.startDate ? { date: s.startDate, balance: Math.round(names.reduce((t, n) => t + (s.openingBalance[n] ?? 0), 0) * 100) / 100 } : null;
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
  private async ops(from: string, to: string, companyIds: Types.ObjectId[]): Promise<{ ops: Op[]; invoices: Op[]; awaiting: Op[] }> {
    const db = this.connection.db!;
    const range = { $gte: new Date(from + 'T00:00:00Z'), $lt: new Date(Date.parse(to + 'T00:00:00Z') + 86400000) };
    const companies = await ourCompanies(this.connection);
    const cname = new Map(companies.map((c) => [String(c.id), c.name]));
    const end = range.$lt;
    const [reqs, incs, shipped, payroll, cats, orgs] = await Promise.all([
      // оплаченные — по дате оплаты (paidAt, нет — дата счёта); неоплаченные с датой счёта в периоде — «счета к оплате»
      db.collection('supplyrequests').find({ deletedAt: null, status: { $ne: 'cancelled' }, priceHint: { $gt: 0 }, companyId: { $in: companyIds }, $or: [
        { paid: true, $or: [{ paidAt: range }, { paidAt: null, invoiceDate: range }] }, { paid: { $ne: true }, invoiceDate: range }] },
        { projection: { num: 1, title: 1, priceHint: 1, invoiceDate: 1, invoiceNo: 1, companyId: 1, categoryId: 1, supplierId: 1, costCenter: 1, salesOrderId: 1, photoIds: 1, paid: 1, paidAt: 1 } }).toArray(),
      db.collection('incomes').find({ deletedAt: null, amount: { $gt: 0 }, companyId: { $in: companyIds }, $or: [{ 'payments.date': range }, { paidDate: range }] },
        { projection: { orderNo: 1, title: 1, amount: 1, paidDate: 1, payments: 1, companyId: 1, customer: 1 } }).toArray(),
      db.collection('incomes').find({ deletedAt: null, amount: { $gt: 0 }, companyId: { $in: companyIds }, paidDate: null, shipDate: { $ne: null, $lt: end } },
        { projection: { orderNo: 1, title: 1, amount: 1, shipDate: 1, payments: 1, paidDate: 1, companyId: 1, customer: 1 } }).toArray(),
      this.payroll.paidOps(from, to, companyIds),
      db.collection('categories').find({}, { projection: { name: 1 } }).toArray(),
      db.collection('organizations').find({}, { projection: { name: 1, shortName: 1 } }).toArray(),
    ]);
    const cat = new Map(cats.map((c) => [String(c._id), String(c.name)]));
    const org = new Map(orgs.map((o) => [String(o._id), String(o.shortName || o.name)]));
    const thumbMap = await firstPhotoThumbs(db, reqs);
    const exp = (r: (typeof reqs)[number], date: string, overdue?: boolean): Op => ({ type: 'expense', id: String(r._id), date, amount: Number(r.priceHint), company: cname.get(String(r.companyId)) ?? '?',
        title: (r.num ? `№${r.num} · ` : '') + String(r.title ?? ''), doc: r.invoiceNo ? String(r.invoiceNo) : undefined,
        category: r.categoryId ? cat.get(String(r.categoryId)) : undefined, counterparty: r.supplierId ? org.get(String(r.supplierId)) : undefined, costCenter: costCenterLabel(r as { costCenter?: unknown; salesOrderId?: unknown }),
        ...(thumbMap.has(String(r._id)) ? { thumb: thumbMap.get(String(r._id)) } : {}), ...(overdue ? { overdue } : {}) });
    const inRange = (d: string) => d >= from && d <= to;
    const incomeOp = (i: (typeof incs)[number], p: IncomePayment, partial: boolean): Op => ({ type: 'income', id: String(i._id), date: iso(p.date), amount: p.amount, company: cname.get(String(i.companyId)) ?? '?',
      title: String(i.title ?? '') + (partial ? ' · частичная оплата' : ''), doc: i.orderNo ? `заказ ${i.orderNo}` : undefined, counterparty: i.customer ? String(i.customer) : undefined, ...(p.method ? { method: p.method } : {}) });
    const today = iso(new Date());
    return {
      ops: [
        ...reqs.filter((r) => r.paid === true).map((r) => exp(r, iso(r.paidAt) || iso(r.invoiceDate))).filter((o) => inRange(o.date)),
        ...incs.flatMap((i) => { const pays = incomePayments(i as { amount?: number; paidDate?: Date; payments?: IncomePayment[] }); return pays.map((p) => incomeOp(i, p, pays.length > 1 || p.amount < Number(i.amount))); }).filter((o) => inRange(o.date)),
        ...payroll.map((p): Op => ({ type: 'expense', id: p.id, date: p.date, amount: p.amount, company: cname.get(p.companyId) ?? '?', title: `${p.kind} · ${p.person}`, category: 'ФОТ', costCenter: 'ФОТ', counterparty: p.person })),
      ],
      invoices: reqs.filter((r) => r.paid !== true).map((r) => exp(r, iso(r.invoiceDate), iso(r.invoiceDate) < today)),
      awaiting: shipped.flatMap((i): Op[] => {
        const left = Math.round((Number(i.amount) - incomePayments(i as { amount?: number; paidDate?: Date; payments?: IncomePayment[] }).reduce((s, p) => s + p.amount, 0)) * 100) / 100;
        return left > 0 ? [{ type: 'income', id: String(i._id), date: iso(i.shipDate), amount: left, company: cname.get(String(i.companyId)) ?? '?', title: String(i.title ?? ''),
          doc: i.orderNo ? `заказ ${i.orderNo}` : undefined, counterparty: i.customer ? String(i.customer) : undefined, overdue: iso(i.shipDate) < from }] : [];
      }),
    };
  }

  /** Что мешает посчитать: заявки с датой счёта без суммы и т.п., доходы без суммы/даты/компании. */
  async needsFill(limit = 300) {
    const db = this.connection.db!;
    const ours = (await ourCompanies(this.connection)).map((c) => c.id);
    const noCompany = { $or: [{ companyId: null }, { companyId: { $exists: false } }, { companyId: { $nin: ours } }] };
    const [reqs, incs] = await Promise.all([
      db.collection('supplyrequests').find({ deletedAt: null, status: { $ne: 'cancelled' }, $or: [
        { invoiceDate: { $ne: null }, $or: [{ priceHint: null }, { priceHint: { $exists: false } }, { priceHint: { $lte: 0 } }] },
        { priceHint: { $gt: 0 }, $or: [{ invoiceDate: null }, { invoiceDate: { $exists: false } }] }, { paid: true, $or: [{ priceHint: null }, { priceHint: { $exists: false } }, { priceHint: { $lte: 0 } }] }, // оплачено без суммы — в календарь не попало
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
    return { total: items.length, items, payrollNoCompany: await this.payroll.unassignedPayments(ours) };
  }

  async cashflow(q: Record<string, unknown>) {
    const { from, to } = this.period(q);
    const opening = q.opening === undefined || q.opening === '' ? 0 : Number(String(q.opening).replace(',', '.'));
    if (!Number.isFinite(opening)) throw new BadRequestException('Начальный остаток — число');
    const { used } = await this.companies(q.org);
    const names = used.map((c) => c.name);
    const ids = used.map((c) => c.id);
    const { ops, invoices, awaiting } = await this.ops(from, to, ids);
    const start = await this.start(names);
    // со стартом учёта остаток на начало периода считается от старта, а не из запроса
    const open = start && start.date < from ? openingFromStart(start, (await this.ops(start.date, iso(new Date(Date.parse(from + 'T00:00:00Z') - 86400000)), ids)).ops, from) : opening;
    const { days, totals } = buildCashflow(ops, from, to, open, names, start);
    // «Ещё не деньги» (В-1, В-2): в остаток не входит; overdue — срок раньше начала периода
    const pending = { invoices: buildPending(invoices, from, to, names), awaiting: buildPending(awaiting, '0000-01-01', to, names) };
    const today = iso(new Date());
    // показатели периода для шапки экрана
    const metrics = {
      received: totals.income, paid: totals.expense, saldo: Math.round((totals.income - totals.expense) * 100) / 100,
      expectedIncome: pending.awaiting.total, invoicesToPay: pending.invoices.total,
      overdueInvoices: Math.round(invoices.filter((o) => o.date < today && o.date <= to).reduce((s, o) => s + o.amount, 0) * 100) / 100,
    };
    return { from, to, org: q.org || 'all', companies: names, opening: open, startDate: start?.date ?? null, days, totals, metrics, pending, needsFill: await this.needsFill() };
  }

  /**
   * Прогноз (TASKS БЗ-1): с сегодня на days дней вперёд (7–180, по умолч. 30), остаток на сегодня — opening.
   * Факт — только оплаченное, поэтому здесь всё неоплаченное: счета к оплате (просроченные — на сегодня, не старше 90 дней),
   * остаток по позициям заказов (за вычетом принятых платежей), ФОТ «начислено, не выплачено».
   */
  async forecast(q: Record<string, unknown>) {
    const days = q.days === undefined || q.days === '' ? 30 : Number(q.days);
    if (!Number.isInteger(days) || days < 7 || days > 180) throw new BadRequestException('Горизонт прогноза — от 7 до 180 дней');
    let opening = q.opening === undefined || q.opening === '' ? 0 : Number(String(q.opening).replace(',', '.'));
    if (!Number.isFinite(opening)) throw new BadRequestException('Остаток на сегодня — число');
    const today = String(q.today && DAY.test(String(q.today)) ? q.today : iso(new Date()));
    const to = iso(new Date(Date.parse(today + 'T00:00:00Z') + (days - 1) * 86400000));
    const { used } = await this.companies(q.org);
    const names = used.map((c) => c.name);
    const ids = used.map((c) => c.id);
    const start = await this.start(names);
    // со стартом учёта остаток на сегодня = остаток на старт + факт [старт, сегодня] (завтра — уже прогноз)
    if (start && start.date <= today) opening = openingFromStart(start, (await this.ops(start.date, today, ids)).ops, iso(new Date(Date.parse(today + 'T00:00:00Z') + 86400000)));
    const cname = new Map(used.map((c) => [String(c.id), c.name]));
    const db = this.connection.db!;
    const stale = new Date(Date.parse(today + 'T00:00:00Z') - 90 * 86400000); // старые неоплаченные счета — не прогноз, а чистка данных
    const [reqs, incs, orgs, payDue] = await Promise.all([
      db.collection('supplyrequests').find({ deletedAt: null, status: { $ne: 'cancelled' }, paid: { $ne: true }, priceHint: { $gt: 0 }, companyId: { $in: ids },
        $or: [{ invoiceDate: { $gte: stale } }, { invoiceDate: null, status: { $in: ['in_progress', 'requested', 'ordered'] } }, { invoiceDate: { $exists: false }, status: { $in: ['in_progress', 'requested', 'ordered'] } }] },
      { projection: { num: 1, title: 1, priceHint: 1, invoiceDate: 1, invoiceNo: 1, companyId: 1, supplierId: 1, status: 1, photoIds: 1 } }).toArray(),
      db.collection('incomes').find({ deletedAt: null, amount: { $gt: 0 }, companyId: { $in: ids }, paidDate: null },
      { projection: { title: 1, amount: 1, companyId: 1, paymentForm: 1, shipDate: 1, orderId: 1, orderNo: 1, customer: 1, createdAt: 1, payments: 1, paidDate: 1 } }).toArray(),
      db.collection('organizations').find({}, { projection: { name: 1, shortName: 1 } }).toArray(),
      this.payroll.dueItems(today, to, ids),
    ]);
    const orders = await db.collection('salesorders').find({ _id: { $in: incs.map((i) => i.orderId).filter(Boolean) } },
      { projection: { stage: 1, deletedAt: 1, contractDate: 1, createdAt: 1, shipDate: 1, productionDeadline: 1, deliveryDeadline: 1, paymentForm: 1 } }).toArray();
    const ord = new Map(orders.map((o) => [String(o._id), o]));
    const org = new Map(orgs.map((o) => [String(o._id), String(o.shortName || o.name)]));
    const thumbMap = await firstPhotoThumbs(db, reqs);
    const expenses: ExpenseSrc[] = reqs.map((r) => ({ id: String(r._id), title: (r.num ? `№${r.num} · ` : '') + String(r.title ?? ''), amount: Number(r.priceHint), company: cname.get(String(r.companyId)) ?? '?',
      invoiceDate: iso(r.invoiceDate) || null, status: String(r.status), doc: r.invoiceNo ? String(r.invoiceNo) : undefined, counterparty: r.supplierId ? org.get(String(r.supplierId)) : undefined, thumb: thumbMap.get(String(r._id)) }));
    const incomes: IncomeSrc[] = incs.flatMap((i) => {
      const o = i.orderId ? ord.get(String(i.orderId)) : undefined;
      if (o && (o.deletedAt || o.stage === 'cancelled')) return [];
      const paid = incomePayments(i as { amount?: number; paidDate?: Date; payments?: IncomePayment[] }).reduce((s, p) => s + p.amount, 0);
      return [{ id: String(i._id), paid, title: String(i.title ?? ''), amount: Number(i.amount), company: cname.get(String(i.companyId)) ?? '?', paymentForm: (i.paymentForm ?? o?.paymentForm) as string | undefined,
        orderNo: i.orderNo ? String(i.orderNo) : undefined, customer: i.customer ? String(i.customer) : undefined,
        orderDate: iso(o?.contractDate) || iso(o?.createdAt) || iso(i.createdAt) || null,
        due: iso(i.shipDate) || iso(o?.shipDate) || iso(o?.productionDeadline) || iso(o?.deliveryDeadline) || null }];
    });
    const { ops, noDate } = expectedOps(expenses, incomes, today);
    // ФОТ: начислено, не выплачено — в день расчёта по графику (просрочено — сегодня)
    for (const p of payDue) {
      const overdue = p.date <= today;
      ops.push({ type: 'expense', id: `payroll:${p.personId}:${p.month}`, date: overdue ? today : p.date, amount: p.amount, company: cname.get(p.companyId) ?? '?', title: `ФОТ · ${p.person} · ${p.month}${overdue ? ' · просрочено' : ''}`, category: 'ФОТ', costCenter: 'ФОТ', counterparty: p.person, overdue });
    }
    const f = buildForecast(ops, today, to, opening, names);
    const sum = (t: string) => Math.round(noDate.filter((x) => x.type === t).reduce((s, x) => s + x.amount, 0) * 100) / 100;
    return { from: today, to, days: f.days, totals: f.totals, companies: names, opening, gapDays: f.gapDays, firstGap: f.firstGap, minBalance: f.minBalance, week: f.week,
      noDate: { items: noDate, expense: sum('expense'), income: sum('income') } };
  }

  async summary(q: Record<string, unknown>) {
    const { from, to } = this.period(q);
    const { used } = await this.companies(q.org);
    const names = used.map((c) => c.name);
    return { from, to, companies: names, ...buildSummary((await this.ops(from, to, used.map((c) => c.id))).ops, from, to, names) };
  }
}
