import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import { Types } from 'mongoose';
import { oid } from '../../common/list-query';
import { dayOf, factSpan, leadDays } from '../../common/work-schedule';
import { daysFromHours, hourRate, median, normSum, perUnit, r2 } from '../../common/work-facts';
import { WHOLE_PRODUCT, type PartRow, type StepRow } from '../../common/work-route-rows';
import { ShowcaseService } from '../showcase/showcase.service';

type Doc = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
/** Сколько последних заказов берём для «Фактически» (медиана). */
export const FACT_ORDERS = 5;
const idOf = (v: unknown) => (v ? String(v) : null);
/** Ключ шага для сравнения плана и изделия: вид работ + название части (id частей у позиции и изделия могут разойтись, имя — нет). */
const stepKeyOf = (workTypeId: unknown, partName: string) => `${String(workTypeId)}|${partName.trim().toLowerCase()}`;

/**
 * C041 Э3 — факт, нормы, сроки, себестоимость.
 * Факт шага — `workhours` (шаг × день, часы) из отметок «начал / закончил»; «Фактически» изделия — медиана факта
 * последних 5 заказов; «Принять как норму» пишет медианы в маршрут изделия (`products.workTypes[].hours`);
 * себестоимость = материалы (состав × последняя закупка) + работы (часы × ставка, DECISIONS Q4).
 * Коллекция `workhours` — только data-core, табель (`payroll_timesheets`) не трогаем и не дублируем (он — для зарплаты).
 */
@Injectable()
export class WorkFactsService {
  constructor(@InjectConnection() private readonly connection: Connection, private readonly showcase: ShowcaseService) {}

  private db() { return this.connection.db!; }
  private hoursCol() { return this.db().collection('workhours'); }
  private plans() { return this.db().collection('orderlineplans'); }
  private products() { return this.db().collection('products'); }

  /** Записать факт-часы шага по отметкам: строки шага перезаписываются (повтор и правка отметок не двоят часы). */
  async recordStep(plan: Doc, stepId: string): Promise<void> {
    const step = ((plan.steps ?? []) as StepRow[]).find((s) => String(s._id) === stepId);
    if (!step?.startedAt || !step?.finishedAt) return;
    const now = new Date();
    const rows = factSpan(new Date(step.startedAt), new Date(step.finishedAt)).map((d) => ({
      planId: plan._id as Types.ObjectId, incomeId: plan.incomeId as Types.ObjectId, stepId: step._id,
      personId: step.assigneeId ?? null, date: d.date, hours: d.hours, source: 'mark', createdAt: now, updatedAt: now,
    }));
    const col = this.hoursCol();
    await col.deleteMany({ stepId: step._id });
    if (rows.length) await col.insertMany(rows as Doc[]);
  }

  /** Часы факта по шагам: stepId → сумма часов (для отметок, сделанных до появления workhours — считаем по датам). */
  async factBySteps(steps: Array<Pick<StepRow, '_id' | 'startedAt' | 'finishedAt'>>): Promise<Map<string, number>> {
    const ids = [...new Set(steps.map((s) => String(s._id)))].filter((x) => /^[0-9a-f]{24}$/i.test(x)).map((x) => new Types.ObjectId(x));
    const rows = ids.length ? await this.hoursCol().aggregate([{ $match: { stepId: { $in: ids } } }, { $group: { _id: '$stepId', hours: { $sum: '$hours' } } }]).toArray() : [];
    const sum = new Map<string, number>(rows.map((r) => [String(r._id), r2(Number(r.hours) || 0)]));
    for (const s of steps) {
      if (sum.has(String(s._id)) || !s.startedAt || !s.finishedAt) continue;
      sum.set(String(s._id), r2(factSpan(new Date(s.startedAt), new Date(s.finishedAt)).reduce((a, d) => a + d.hours, 0)));
    }
    return sum;
  }

  /** Названия видов работ (только живые). */
  private async typeNames(ids: unknown[]): Promise<Map<string, string>> {
    const uniq = [...new Set(ids.filter(Boolean).map(String))].filter((x) => /^[0-9a-f]{24}$/i.test(x)).map((x) => new Types.ObjectId(x));
    if (!uniq.length) return new Map();
    const rows = await this.db().collection('worktypes').find({ _id: { $in: uniq }, deletedAt: null }, { projection: { name: 1 } }).toArray();
    return new Map(rows.map((t) => [String(t._id), String(t.name ?? '')]));
  }

  /** Шаги изделия для сравнения: ключ, вид работ, часть, текущая норма часов. */
  private productSteps(prod: Doc): Array<{ key: string; workTypeId: string; partName: string; hours: number | null }> {
    const partName = new Map(((prod.parts as PartRow[] | undefined) ?? []).map((p) => [String(p._id), p.name]));
    return ((prod.workTypes as Array<Partial<StepRow>> | undefined) ?? []).filter((w) => w.workTypeId).map((w) => {
      const name = w.partRowId ? partName.get(String(w.partRowId)) ?? WHOLE_PRODUCT : WHOLE_PRODUCT;
      return { key: stepKeyOf(w.workTypeId, name), workTypeId: String(w.workTypeId), partName: name, hours: w.hours === undefined || w.hours === null ? null : Number(w.hours) };
    });
  }

  /**
   * «Фактически» по изделию: медиана факта последних 5 заказов — по шагам и всего.
   * Заказ учитывается, если в его плане есть факт хотя бы одного шага; по шагу считаются заказы, где факт этого шага есть.
   */
  private async collect(productId: string) {
    const pid = oid(productId, 'изделия');
    const prod = (await this.products().findOne({ _id: pid, deletedAt: null }, { projection: { name: 1, parts: 1, workTypes: 1 } })) as Doc | null;
    if (!prod) throw new NotFoundException('Изделие не найдено');
    const steps = this.productSteps(prod);
    const empty = { prod, steps: steps.map((s) => ({ ...s, hoursPerUnit: null as number | null, sample: 0 })), rows: [] as Doc[], total: { hoursPerUnit: null as number | null, sample: 0 }, used: [] as Doc[] };
    const incomes = (await this.db().collection('incomes').find({ productId: pid, deletedAt: null }, { projection: { orderNo: 1, title: 1, qty: 1 } }).sort({ createdAt: -1 }).limit(500).toArray()) as Doc[];
    if (!incomes.length) return empty;
    const inc = new Map(incomes.map((i) => [String(i._id), i]));
    const plans = (await this.plans().find({ incomeId: { $in: [...inc.keys()].map((x) => new Types.ObjectId(x)) }, deletedAt: null }, { projection: { incomeId: 1, parts: 1, steps: 1, updatedAt: 1 } }).toArray()) as Doc[];
    if (!plans.length) return empty;
    const allSteps = plans.flatMap((p) => ((p.steps as StepRow[] | undefined) ?? []));
    const fact = await this.factBySteps(allSteps);
    const rows: Array<{ incomeId: string; orderNo: string | null; lineTitle: string; qty: number; finishedAt: Date | null; per: Map<string, number>; total: number }> = [];
    for (const p of plans) {
      const income = inc.get(String(p.incomeId));
      if (!income) continue;
      const qty = Math.max(1, Number(income.qty) || 1);
      const partName = new Map(((p.parts as PartRow[] | undefined) ?? []).map((x) => [String(x._id), x.name]));
      const per = new Map<string, number>();
      let total = 0, any = false, finished: Date | null = null;
      for (const s of (p.steps as StepRow[] | undefined) ?? []) {
        const h = fact.get(String(s._id));
        if (h == null) continue;
        any = true;
        const name = s.partRowId ? partName.get(String(s.partRowId)) ?? WHOLE_PRODUCT : WHOLE_PRODUCT;
        const key = stepKeyOf(s.workTypeId, name);
        per.set(key, (per.get(key) ?? 0) + h);
        total += h;
        if (s.finishedAt) { const d = new Date(s.finishedAt); if (!finished || d > finished) finished = d; }
      }
      if (!any) continue;
      rows.push({ incomeId: String(p.incomeId), orderNo: (income.orderNo as string | undefined) ?? null, lineTitle: String(income.title ?? ''), qty, finishedAt: finished ?? ((p.updatedAt as Date | undefined) ?? null), per: new Map([...per].map(([k, v]) => [k, perUnit(v, qty)])), total: perUnit(total, qty) });
    }
    rows.sort((a, b) => (b.finishedAt?.getTime() ?? 0) - (a.finishedAt?.getTime() ?? 0));
    const last = rows.slice(0, FACT_ORDERS);
    const outSteps = steps.map((s) => {
      const values = last.map((r) => r.per.get(s.key)).filter((v): v is number => typeof v === 'number');
      return { ...s, hoursPerUnit: median(values), sample: values.length };
    });
    const total = median(last.map((r) => r.total));
    return { prod, steps: outSteps, rows: last, total: { hoursPerUnit: total, sample: last.length } };
  }

  /** «Фактически» изделия для карточки и предложения нормы. */
  async productFacts(productId: string) {
    const { prod, steps, rows, total } = await this.collect(productId);
    const names = await this.typeNames(steps.map((s) => s.workTypeId));
    return {
      productId: String(prod._id), productName: String(prod.name ?? ''),
      orders: rows.length,
      used: rows.map((r) => ({ incomeId: r.incomeId, orderNo: r.orderNo, lineTitle: r.lineTitle, finishedAt: r.finishedAt ? r.finishedAt.toISOString() : null, hoursPerUnit: r.total })),
      steps: steps.map((s) => ({
        workTypeId: s.workTypeId, workTypeName: names.get(s.workTypeId) ?? 'вид работ удалён', partName: s.partName,
        hoursPerUnit: s.hoursPerUnit, daysPerUnit: s.hoursPerUnit == null ? null : daysFromHours(s.hoursPerUnit), sample: s.sample, normHours: s.hours,
      })),
      total: { hoursPerUnit: total.hoursPerUnit, daysPerUnit: total.hoursPerUnit == null ? null : daysFromHours(total.hoursPerUnit), sample: total.sample },
      normTotalHours: normSum(steps.map((s) => s.hours)),
    };
  }

  /** «Принять как норму»: медианы факта записываются в маршрут изделия (`products.workTypes[].hours`). Нет факта у шага — пропуск. */
  async applyNorm(productId: string) {
    const { prod, steps } = await this.collect(productId);
    const byKey = new Map(steps.filter((s) => s.hoursPerUnit != null).map((s) => [s.key, s.hoursPerUnit!]));
    const partName = new Map(((prod.parts as PartRow[] | undefined) ?? []).map((p) => [String(p._id), p.name]));
    let applied = 0, skipped = 0, totalHours = 0;
    const types = ((prod.workTypes as Array<Partial<StepRow>> | undefined) ?? []).map((w) => {
      const name = w.partRowId ? partName.get(String(w.partRowId)) ?? WHOLE_PRODUCT : WHOLE_PRODUCT;
      const hours = byKey.get(stepKeyOf(w.workTypeId, name));
      if (hours == null) { skipped++; return w; }
      applied++; totalHours += hours;
      return { ...w, hours };
    });
    if (applied) await this.products().updateOne({ _id: prod._id }, { $set: { workTypes: types, updatedAt: new Date() } });
    return { applied, skipped, totalHours: r2(totalHours) };
  }

  /** Срок позиции: рабочие дни плана (нормы × количество) от сегодня; нет работ/норм — 0. */
  async planLead(plan: Doc, qty: number): Promise<number> {
    const steps = ((plan.steps as StepRow[] | undefined) ?? []).filter((s) => s.hours);
    if (!steps.length) return 0;
    return leadDays(steps.map((s) => ({ id: String(s._id), part: s.partRowId ? String(s.partRowId) : null, hours: (s.hours ?? 0) * Math.max(1, qty), plan: s.plan ? { start: new Date(s.plan.start), end: new Date(s.plan.end) } : null })), dayOf(new Date())).days;
  }

  /** Себестоимость: материалы (состав × последняя закупка) + работы (часы × ставка, Q4). Без права «Деньги» — скрыто. */
  async cost(q: { incomeId?: string; productId?: string }, canMoney: boolean) {
    const incomeId = q.incomeId ? oid(q.incomeId, 'позиции') : null;
    const productId = q.productId ? oid(q.productId, 'изделия') : null;
    if (!incomeId === !productId) throw new BadRequestException('Укажите позицию заказа или изделие — по одному');
    const scope = incomeId ? 'income' : 'product';
    if (!canMoney) return { scope, id: String(incomeId ?? productId), hidden: true };
    const db = this.db();
    let inc: Doc | null = null, qty = 1;
    if (incomeId) {
      inc = (await db.collection('incomes').findOne({ _id: incomeId, deletedAt: null }, { projection: { productId: 1, qty: 1 } })) as Doc | null;
      if (!inc) throw new NotFoundException('Позиция заказа не найдена');
      qty = Math.max(1, Number(inc.qty) || 1);
    }
    const pid = incomeId ? (inc?.productId as Types.ObjectId | undefined) ?? null : productId;
    const prod = pid ? ((await this.products().findOne({ _id: pid, deletedAt: null }, { projection: { name: 1, parts: 1, workTypes: 1 } })) as Doc | null) : null;
    // часы по нормам: у позиции — шаги плана × количество; у изделия — маршрут на 1 шт.
    let rows: Array<{ workTypeId: string; partName: string; hours: number; assigneeId: string | null }> = [];
    if (incomeId) {
      const plan = (await this.plans().findOne({ incomeId, deletedAt: null }, { projection: { parts: 1, steps: 1 } })) as Doc | null;
      const partName = new Map(((plan?.parts as PartRow[] | undefined) ?? []).map((p) => [String(p._id), p.name]));
      const steps = ((plan?.steps as StepRow[] | undefined) ?? []).filter((s) => s.hours || s.startedAt || s.finishedAt);
      const fact = await this.factBySteps(steps);
      rows = steps.map((s) => {
        const factHours = fact.get(String(s._id));
        // часы работ: известен факт — берём его, иначе норма × количество (Q4: факт важнее плана)
        const hours = factHours != null && factHours > 0 ? factHours : r2((s.hours ?? 0) * qty);
        return { workTypeId: String(s.workTypeId), partName: s.partRowId ? partName.get(String(s.partRowId)) ?? WHOLE_PRODUCT : WHOLE_PRODUCT, hours, assigneeId: idOf(s.assigneeId) };
      }).filter((r) => r.hours > 0);
    } else if (prod) {
      const partName = new Map(((prod.parts as PartRow[] | undefined) ?? []).map((p) => [String(p._id), p.name]));
      rows = ((prod.workTypes as Array<Partial<StepRow>> | undefined) ?? []).filter((w) => Number(w.hours) > 0).map((w) => ({
        workTypeId: String(w.workTypeId), partName: w.partRowId ? partName.get(String(w.partRowId)) ?? WHOLE_PRODUCT : WHOLE_PRODUCT,
        hours: r2(Number(w.hours)), assigneeId: null,
      }));
    }
    // ставки: человек (почасовая) → вид работ → «нет ставки»
    const typeIds = [...new Set(rows.map((r) => r.workTypeId))].filter((x) => /^[0-9a-f]{24}$/i.test(x));
    const personIds = [...new Set(rows.map((r) => r.assigneeId).filter(Boolean))] as string[];
    const [types, persons, names] = await Promise.all([
      typeIds.length ? db.collection('worktypes').find({ _id: { $in: typeIds.map((x) => new Types.ObjectId(x)) } }, { projection: { name: 1, hourlyRate: 1 } }).toArray() : Promise.resolve([] as Doc[]),
      personIds.length ? db.collection('persons').find({ _id: { $in: personIds.map((x) => new Types.ObjectId(x)) } }, { projection: { salaryKind: 1, salaryRate: 1 } }).toArray() : Promise.resolve([] as Doc[]),
      this.typeNames(typeIds),
    ]);
    const typeOf = new Map(types.map((t) => [String(t._id), t as Doc]));
    const personOf = new Map(persons.map((p) => [String(p._id), p as Doc]));
    let missingRate = 0;
    const lines = rows.map((r) => {
      const type = typeOf.get(r.workTypeId);
      const { rate, source } = hourRate(r.assigneeId ? personOf.get(r.assigneeId) : null, Number(type?.hourlyRate) > 0 ? Number(type?.hourlyRate) : null);
      if (rate == null) missingRate++;
      return {
        workTypeId: r.workTypeId, workTypeName: names.get(r.workTypeId) ?? 'вид работ удалён', partName: r.partName,
        hours: r.hours, rate: rate == null ? null : r2(rate), rateSource: source, sum: rate == null ? null : r2(r.hours * rate),
      };
    });
    const worksTotal = r2(lines.reduce((s, x) => s + (x.sum ?? 0), 0));
    const worksHours = r2(lines.reduce((s, x) => s + x.hours, 0));
    const materials = pid ? await this.showcase.compositionCost(String(pid)) : null;
    const matTotal = materials ? r2(materials.total * qty) : null;
    const any = matTotal != null || worksTotal > 0;
    return {
      scope, id: String(incomeId ?? productId), qty,
      productId: pid ? String(pid) : null, productName: prod ? String(prod.name ?? '') : null,
      materials: materials ? { total: matTotal, missing: materials.missing } : null,
      works: { total: worksTotal, hours: worksHours, missingRate, lines },
      total: any ? r2((matTotal ?? 0) + worksTotal) : null,
    };
  }
}
