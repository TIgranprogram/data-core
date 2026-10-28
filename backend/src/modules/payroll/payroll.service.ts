import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import { Types } from 'mongoose';
import { parseSheetDate } from '../../common/date-parse';
import { oid } from '../../common/list-query';
import { ourCompanies } from '../incomes/incomes.service';
import type { PayoutDto, TimesheetDto } from './dto';
import { MONTH, PAY_KIND_LABEL, accrued, dueDate, monthsBetween, payoutDays, r2, type PayKind } from './payroll-calc';

type Doc = Record<string, unknown>;
const iso = (d: unknown) => (d instanceof Date && !Number.isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : '');
const personName = (p: Doc) => [p.lastName, p.firstName].map((x) => String(x ?? '').trim()).filter(Boolean).join(' ') || 'Без имени';

/** Что платить: начислено минус выплачено за месяц, для прогноза календаря. */
export interface PayrollDue { personId: string; person: string; month: string; amount: number; date: string; companyId: string }
/** Выплата, уже сделанная, — расход календаря. */
export interface PayrollPaid { id: string; person: string; kind: string; date: string; amount: number; companyId: string; month: string }

/**
 * ФОТ (В-3, «на руки», без налогов). Табель по месяцам → начисление = ставка × табель; выплаты (дата, сумма, вид).
 * Выплаты идут в платёжный календарь как расход «ФОТ», начисленное, но не выплаченное — в прогноз.
 * Коллекции: payroll_timesheets {personId, month, hours, days, normDays}, payroll_payments {personId, companyId, date, amount, kind, month}.
 * Ставка и вид оплаты — persons.salaryRate / salaryKind (справочник «Сотрудники»); компания — persons.companyId.
 */
@Injectable()
export class PayrollService {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  private get db() { return this.connection.db!; }

  private month(m?: string) {
    const v = m || new Date().toISOString().slice(0, 7);
    if (!MONTH.test(v)) throw new BadRequestException('Месяц — в формате ГГГГ-ММ');
    return v;
  }

  /** Сотрудники со ставкой, графиком выплат и компанией. */
  private async people() {
    const [persons, schedules] = await Promise.all([
      this.db.collection('persons').find({ deletedAt: null }).toArray() as Promise<Doc[]>,
      this.db.collection('dict_values').find({ dict: 'payoutSchedules', deletedAt: null }).toArray() as Promise<Doc[]>,
    ]);
    const days = new Map(schedules.map((s) => [String(s._id), payoutDays(s.days)]));
    return persons.map((p) => ({
      id: String(p._id), name: personName(p), position: p.position ? String(p.position) : null, status: String(p.status || 'active'),
      kind: (p.salaryKind as string) || null, rate: Number(p.salaryRate) > 0 ? Number(p.salaryRate) : null,
      companyId: p.companyId ? String(p.companyId) : null, payoutDays: p.payoutScheduleId ? days.get(String(p.payoutScheduleId)) ?? [] : [],
    }));
  }

  /** Строки ФОТ за месяц: по каждому человеку табель, начислено, выплачено, остаток. */
  private async rows(month: string) {
    const [people, sheets, pays] = await Promise.all([
      this.people(),
      this.db.collection('payroll_timesheets').find({ month, deletedAt: null }).toArray() as Promise<Doc[]>,
      this.db.collection('payroll_payments').find({ month, deletedAt: null }).toArray() as Promise<Doc[]>,
    ]);
    const sheet = new Map(sheets.map((s) => [String(s.personId), s]));
    const paid = new Map<string, number>();
    for (const p of pays) paid.set(String(p.personId), r2((paid.get(String(p.personId)) ?? 0) + Number(p.amount)));
    return people
      // уволенные и без ставки — только если за месяц есть табель или выплата
      .filter((p) => (p.status !== 'fired' && p.rate) || sheet.has(p.id) || paid.has(p.id))
      .map((p) => {
        const ts = sheet.get(p.id);
        const acc = accrued(p.kind, p.rate, ts as { hours?: number; days?: number; normDays?: number } | undefined);
        const pd = paid.get(p.id) ?? 0;
        return { ...p, hours: ts?.hours ?? null, days: ts?.days ?? null, normDays: ts?.normDays ?? null, timesheetNote: ts?.note ?? null,
          hasTimesheet: !!ts, accrued: acc, paid: pd, balance: r2(acc - pd), dueDate: dueDate(month, p.payoutDays) };
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  }

  async summary(monthIn?: string) {
    const month = this.month(monthIn);
    const [rows, companies] = await Promise.all([this.rows(month), ourCompanies(this.connection)]);
    const cname = new Map(companies.map((c) => [String(c.id), c.name]));
    const items = rows.map((r) => ({ ...r, companyName: r.companyId ? cname.get(r.companyId) ?? null : null }));
    const byCompany = new Map<string, { company: string; accrued: number; paid: number; balance: number }>();
    for (const r of items) {
      const key = r.companyName ?? 'Компания не указана';
      const c = byCompany.get(key) ?? { company: key, accrued: 0, paid: 0, balance: 0 };
      c.accrued = r2(c.accrued + r.accrued); c.paid = r2(c.paid + r.paid); c.balance = r2(c.balance + r.balance);
      byCompany.set(key, c);
    }
    const sum = (k: 'accrued' | 'paid' | 'balance') => r2(items.reduce((s, r) => s + r[k], 0));
    return {
      month, items, totals: { accrued: sum('accrued'), paid: sum('paid'), balance: sum('balance') }, byCompany: [...byCompany.values()],
      /** Подсказка пустого экрана: сколько работающих без ставки. */
      noRate: (await this.people()).filter((p) => p.status !== 'fired' && !p.rate).length,
      kinds: PAY_KIND_LABEL,
    };
  }

  async saveTimesheet(dto: TimesheetDto) {
    const personId = oid(dto.personId, 'сотрудника');
    if (!(await this.db.collection('persons').findOne({ _id: personId, deletedAt: null }, { projection: { _id: 1 } }))) throw new NotFoundException('Сотрудник не найден');
    const set: Doc = { updatedAt: new Date(), deletedAt: null }, unset: Record<string, ''> = {};
    for (const k of ['hours', 'days', 'normDays'] as const) if (dto[k] !== undefined) (dto[k] === null ? (unset[k] = '') : (set[k] = r2(Number(dto[k]))));
    if (dto.note !== undefined) (dto.note.trim() ? (set.note = dto.note.trim()) : (unset.note = ''));
    await this.db.collection('payroll_timesheets').updateOne({ personId, month: dto.month },
      { $set: set, $setOnInsert: { personId, month: dto.month, createdAt: new Date() }, ...(Object.keys(unset).length ? { $unset: unset } : {}) }, { upsert: true });
    return (await this.rows(dto.month)).find((r) => r.id === dto.personId) ?? null;
  }

  async payments(monthIn?: string, personId?: string) {
    const q: Doc = { deletedAt: null };
    if (monthIn) q.month = this.month(monthIn);
    if (personId) q.personId = oid(personId, 'сотрудника');
    const [docs, people, companies] = await Promise.all([
      this.db.collection('payroll_payments').find(q).sort({ date: -1 }).limit(500).toArray() as Promise<Doc[]>,
      this.people(), ourCompanies(this.connection),
    ]);
    const pname = new Map(people.map((p) => [p.id, p.name]));
    const cname = new Map(companies.map((c) => [String(c.id), c.name]));
    const items = docs.map((d) => ({ id: String(d._id), personId: String(d.personId), person: pname.get(String(d.personId)) ?? '?', companyId: String(d.companyId), company: cname.get(String(d.companyId)) ?? null,
      date: iso(d.date), amount: Number(d.amount), kind: String(d.kind), kindLabel: PAY_KIND_LABEL[d.kind as PayKind] ?? String(d.kind), month: String(d.month), note: d.note ? String(d.note) : null }));
    return { items, total: items.length, sum: r2(items.reduce((s, i) => s + i.amount, 0)) };
  }

  async addPayment(dto: PayoutDto, userId?: string) {
    const date = parseSheetDate(dto.date);
    if (!date) throw new BadRequestException('Дата выплаты — в формате ДД.ММ.ГГГГ');
    const personId = oid(dto.personId, 'сотрудника'), companyId = oid(dto.companyId, 'компании');
    if (!(await this.db.collection('persons').findOne({ _id: personId, deletedAt: null }, { projection: { _id: 1 } }))) throw new NotFoundException('Сотрудник не найден');
    if (!(await ourCompanies(this.connection)).some((c) => String(c.id) === String(companyId))) throw new BadRequestException('Выберите нашу компанию из списка');
    const doc = { personId, companyId, date, amount: r2(dto.amount), kind: dto.kind || 'salary', month: dto.month || date.toISOString().slice(0, 7), note: dto.note?.trim() || undefined,
      createdBy: userId && Types.ObjectId.isValid(userId) ? new Types.ObjectId(userId) : undefined, deletedAt: null, createdAt: new Date() };
    const res = await this.db.collection('payroll_payments').insertOne(doc);
    return { id: String(res.insertedId), month: doc.month };
  }

  async removePayment(id: string) {
    const res = await this.db.collection('payroll_payments').updateOne({ _id: oid(id, 'выплаты'), deletedAt: null }, { $set: { deletedAt: new Date() } });
    if (!res.matchedCount) throw new NotFoundException('Выплата не найдена');
    return { id, deleted: true };
  }

  async setCompany(id: string, companyId: string | null) {
    const _id = oid(id, 'сотрудника');
    if (companyId && !(await ourCompanies(this.connection)).some((c) => String(c.id) === companyId)) throw new BadRequestException('Выберите нашу компанию из списка');
    const res = await this.db.collection('persons').updateOne({ _id, deletedAt: null }, companyId ? { $set: { companyId: new Types.ObjectId(companyId) } } : { $unset: { companyId: '' } });
    if (!res.matchedCount) throw new NotFoundException('Сотрудник не найден');
    return { id, companyId };
  }

  /** Сделанные выплаты периода — расход календаря «ФОТ». Без нашей компании в расчёт не идут (см. unassignedPayments). */
  async paidOps(from: string, to: string, companyIds: Types.ObjectId[]): Promise<PayrollPaid[]> {
    const range = { $gte: new Date(from + 'T00:00:00Z'), $lt: new Date(Date.parse(to + 'T00:00:00Z') + 86400000) };
    const [docs, people] = await Promise.all([
      this.db.collection('payroll_payments').find({ deletedAt: null, date: range, companyId: { $in: companyIds } }).toArray() as Promise<Doc[]>,
      this.people(),
    ]);
    const pname = new Map(people.map((p) => [p.id, p.name]));
    return docs.map((d) => ({ id: String(d._id), person: pname.get(String(d.personId)) ?? '?', kind: PAY_KIND_LABEL[d.kind as PayKind] ?? 'Выплата', date: iso(d.date), amount: Number(d.amount), companyId: String(d.companyId), month: String(d.month) }));
  }

  /** Выплаты без нашей компании — «требуют заполнения». */
  unassignedPayments(ours: Types.ObjectId[]) {
    return this.db.collection('payroll_payments').countDocuments({ deletedAt: null, companyId: { $nin: ours } });
  }

  /**
   * Начислено, но не выплачено — в прогноз. Месяцы: прошлый, текущий и до горизонта; прошлый месяц — только если по нему
   * есть табель или выплата (иначе «долг» без данных выдуманный). Без компании у сотрудника — не считается.
   */
  async dueItems(today: string, to: string, companyIds: Types.ObjectId[]): Promise<PayrollDue[]> {
    const prev = new Date(today.slice(0, 7) + '-01T00:00:00Z'); prev.setUTCMonth(prev.getUTCMonth() - 1);
    const ids = new Set(companyIds.map(String));
    const out: PayrollDue[] = [];
    for (const month of monthsBetween(prev.toISOString().slice(0, 7), to.slice(0, 7))) {
      for (const r of await this.rows(month)) {
        if (!(r.balance > 0) || !r.companyId || !ids.has(r.companyId) || r.dueDate > to) continue;
        if (month < today.slice(0, 7) && !r.hasTimesheet && !(r.paid > 0)) continue;
        out.push({ personId: r.id, person: r.name, month, amount: r.balance, date: r.dueDate, companyId: r.companyId });
      }
    }
    return out;
  }
}
