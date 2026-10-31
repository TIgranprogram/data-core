import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { InjectConnection } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import { Types } from 'mongoose';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { oid } from '../../common/list-query';
import { StockService } from '../stock/stock.service';
import { IncomesService } from './incomes.service';

type Doc = Record<string, unknown>;
type Dep = { id: string; label: string; status?: string; qty?: number };

/** Что зависит от позиции заказа. `blockers` — мешает отмене и переносу всегда; остальное можно снять с галочкой. */
export interface LineDeps {
  id: string; lineNo: number | null; title: string; cancelled: boolean; cancelReason: string | null;
  blockers: string[];
  reservations: Dep[]; designTasks: Dep[]; workTasks: Dep[]; supplyRequests: Dep[]; passports: Dep[];
  payments: number; shipments: number; issues: number;
}

const s = (v: unknown) => String(v ?? '');
const oidOf = (v: unknown) => v as Types.ObjectId;

/**
 * Этап 3 заказов: отмена и перенос позиций, список зависимостей. Позиция не удаляется: ставится `cancelledAt` + причина,
 * и все расчёты (суммы, долги, производство, паспорта, отгрузки) её пропускают (`cancelledAt: null` в запросах).
 */
@Injectable()
export class IncomeCancelService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    private readonly incomes: IncomesService,
    private readonly moduleRef: ModuleRef,
  ) {}

  private db() { return this.connection.db!; }
  private coll(n: string) { return this.db().collection(n); }

  /** Зависимости позиций одним проходом. */
  async depsOfLines(lines: Doc[]): Promise<LineDeps[]> {
    const ids = lines.map((l) => oidOf(l._id));
    if (!ids.length) return [];
    const [resv, design, work, supply, pass, ships, moves] = await Promise.all([
      this.coll('reservations').find({ salesOrderLineId: { $in: ids }, status: 'active', deletedAt: null }, { projection: { salesOrderLineId: 1, qty: 1, groupName: 1 } }).toArray(),
      this.coll('designtasks').find({ incomeId: { $in: ids }, status: { $in: ['queue', 'work', 'paused'] }, deletedAt: null }, { projection: { incomeId: 1, status: 1, code: 1, title: 1 } }).toArray(),
      this.coll('worktasks').find({ incomeId: { $in: ids }, status: { $in: ['waiting', 'work'] }, deletedAt: null }, { projection: { incomeId: 1, status: 1, code: 1, stepKey: 1 } }).toArray(),
      this.coll('supplyrequests').find({ salesOrderLineId: { $in: ids }, status: { $nin: ['received', 'cancelled'] }, deletedAt: null }, { projection: { salesOrderLineId: 1, status: 1, num: 1, title: 1, qty: 1 } }).toArray(),
      this.coll('productpassports').find({ incomeId: { $in: ids }, status: { $ne: 'annulled' }, deletedAt: null }, { projection: { incomeId: 1, status: 1, passportNumber: 1 } }).toArray(),
      this.coll('shipments').find({ 'lines.incomeId': { $in: ids }, deletedAt: null }, { projection: { lines: 1, num: 1 } }).toArray(),
      this.coll('stockmovements').find({ salesOrderLineId: { $in: ids }, deletedAt: null, cancelledAt: null }, { projection: { salesOrderLineId: 1 } }).toArray(),
    ]);
    const by = (rows: Doc[], f: string) => { const m = new Map<string, Doc[]>(); for (const r of rows) { const k = s(r[f]); m.set(k, [...(m.get(k) ?? []), r]); } return m; };
    const rV = by(resv, 'salesOrderLineId'), rD = by(design, 'incomeId'), rW = by(work, 'incomeId'), rS = by(supply, 'salesOrderLineId'), rP = by(pass, 'incomeId'), rM = by(moves, 'salesOrderLineId');
    const shipsOf = new Map<string, number>();
    for (const sh of ships) for (const l of (sh.lines as Array<{ incomeId: unknown }> | undefined) ?? []) shipsOf.set(s(l.incomeId), (shipsOf.get(s(l.incomeId)) ?? 0) + 1);
    return lines.map((l) => {
      const id = s(l._id);
      const pays = ((l.payments as unknown[] | undefined) ?? []).length || (Number(l.paidAmount) > 0 || l.paidDate ? 1 : 0);
      const shipments = shipsOf.get(id) ?? 0, issues = (rM.get(id) ?? []).length;
      const blockers: string[] = [];
      if (pays) blockers.push('есть оплата — сначала уберите платежи в карточке позиции');
      if (shipments) blockers.push(`позиция в отгрузках (${shipments}) — сначала отмените отгрузку`);
      if (issues) blockers.push(`по позиции есть выдачи со склада (${issues})`);
      return {
        id, lineNo: (l.lineNo as number | undefined) ?? null, title: s(l.title), cancelled: !!l.cancelledAt, cancelReason: l.cancelReason ? s(l.cancelReason) : null,
        blockers,
        reservations: (rV.get(id) ?? []).map((r) => ({ id: s(r._id), label: s(r.groupName || 'Бронь'), qty: Number(r.qty) || 0 })),
        designTasks: (rD.get(id) ?? []).map((r) => ({ id: s(r._id), label: s(r.code || r.title || 'Задача проектирования'), status: s(r.status) })),
        workTasks: (rW.get(id) ?? []).map((r) => ({ id: s(r._id), label: s(r.code || r.stepKey || 'Задание в работе'), status: s(r.status) })),
        supplyRequests: (rS.get(id) ?? []).map((r) => ({ id: s(r._id), label: s(r.num ? `№ ${r.num} ${r.title ?? ''}` : r.title || 'Заявка'), status: s(r.status), qty: Number(r.qty) || undefined })),
        passports: (rP.get(id) ?? []).map((r) => ({ id: s(r._id), label: s(r.passportNumber || 'Паспорт'), status: s(r.status) })),
        payments: pays, shipments, issues,
      };
    });
  }

  /** `GET /salesorders/:id/dependencies` — по договору и по каждой позиции. */
  async dependencies(orderId: string) {
    const _id = oid(orderId, 'заказа');
    const order = await this.coll('salesorders').findOne({ _id, deletedAt: null }, { projection: { orderNo: 1, productionNo: 1, stage: 1 } });
    if (!order) throw new NotFoundException('Заказ не найден');
    const lines = await this.coll('incomes').find({ orderId: _id, deletedAt: null }).sort({ lineNo: 1, createdAt: 1, _id: 1 }).toArray();
    const items = await this.depsOfLines(lines as Doc[]);
    const alive = items.filter((i) => !i.cancelled);
    const total = (k: 'reservations' | 'designTasks' | 'workTasks' | 'supplyRequests' | 'passports') => alive.reduce((n, i) => n + i[k].length, 0);
    const shipmentsCount = await this.coll('shipments').countDocuments({ orderId: _id, deletedAt: null });
    return {
      orderId: s(_id), orderNo: s(order.orderNo), productionNo: order.productionNo ? s(order.productionNo) : null, stage: s(order.stage || 'new'),
      shipments: shipmentsCount, payments: alive.reduce((n, i) => n + i.payments, 0),
      reservations: total('reservations'), designTasks: total('designTasks'), workTasks: total('workTasks'), supplyRequests: total('supplyRequests'), passports: total('passports'),
      lines: items,
    };
  }

  private async lineOr404(id: string) {
    const cur = await this.coll('incomes').findOne({ _id: oid(id, 'позиции'), deletedAt: null });
    if (!cur) throw new NotFoundException('Позиция не найдена');
    return cur as Doc;
  }

  /** Отмена с причиной. Без `cascade` при зависимостях — 409 со списком (`details`); оплата, отгрузка и выдачи блокируют всегда. */
  async cancel(id: string, reasonRaw: string, cascade: boolean, actor?: AuthenticatedUser) {
    const reason = String(reasonRaw ?? '').trim();
    if (reason.length < 3) throw new BadRequestException('Укажите причину отмены');
    const cur = await this.lineOr404(id);
    if (cur.cancelledAt) throw new ConflictException('Позиция уже отменена');
    await this.incomes.assertCanChange(cur.orderId, actor);
    const [deps] = await this.depsOfLines([cur]);
    if (deps.blockers.length) throw new ConflictException({ statusCode: 409, message: `Позицию нельзя отменить: ${deps.blockers.join('; ')}`, details: deps });
    const hasDeps = deps.reservations.length || deps.designTasks.length || deps.workTasks.length;
    if (hasDeps && !cascade) {
      throw new ConflictException({ statusCode: 409, message: 'У позиции есть брони и задачи — решите, снимать ли их', details: deps });
    }
    if (cascade) await this.releaseDeps(deps, reason);
    const now = new Date();
    await this.coll('incomes').updateOne({ _id: oidOf(cur._id) }, { $set: { cancelledAt: now, cancelReason: reason, editedInApp: true, updatedAt: now, ...(actor && Types.ObjectId.isValid(actor.id) ? { cancelledBy: new Types.ObjectId(actor.id) } : {}) } });
    return { ...(await this.incomes.get(id)), released: cascade ? { reservations: deps.reservations.length, designTasks: deps.designTasks.length, workTasks: deps.workTasks.length } : undefined };
  }

  private async releaseDeps(d: LineDeps, reason: string) {
    const stock = this.moduleRef.get(StockService, { strict: false });
    for (const r of d.reservations) await stock.releaseReservation(r.id).catch((e) => { if (!(e instanceof NotFoundException || e instanceof ConflictException)) throw e; });
    const now = new Date();
    const why = `Позиция отменена: ${reason}`;
    if (d.designTasks.length) await this.coll('designtasks').updateMany({ _id: { $in: d.designTasks.map((x) => new Types.ObjectId(x.id)) } }, { $set: { status: 'cancelled', pauseReason: why, updatedAt: now }, $unset: { openIncomeId: '' } });
    if (d.workTasks.length) await this.coll('worktasks').updateMany({ _id: { $in: d.workTasks.map((x) => new Types.ObjectId(x.id)) } }, { $set: { status: 'cancelled', cancelReason: why, updatedAt: now }, $unset: { openIncomeId: '' } });
  }

  /** Вернуть отменённую позицию. Брони и задачи не возвращаются — их создают заново. */
  async restoreCancelled(id: string, actor?: AuthenticatedUser) {
    const cur = await this.lineOr404(id);
    if (!cur.cancelledAt) throw new ConflictException('Позиция не отменена');
    await this.incomes.assertCanChange(cur.orderId, actor);
    await this.coll('incomes').updateOne({ _id: oidOf(cur._id) }, { $unset: { cancelledAt: '', cancelReason: '', cancelledBy: '' }, $set: { editedInApp: true, updatedAt: new Date() } });
    return this.incomes.get(id);
  }

  /** Перенос позиции в другой договор вместе со ссылками. Оплаты, отгрузки и выдачи со склада не пускают. */
  async move(id: string, toOrderId: string, actor?: AuthenticatedUser) {
    const cur = await this.lineOr404(id);
    if (cur.cancelledAt) throw new ConflictException('Отменённую позицию сначала верните');
    const target = oid(toOrderId, 'договора');
    if (cur.orderId && s(cur.orderId) === s(target)) throw new ConflictException('Позиция уже в этом договоре');
    const head = await this.coll('salesorders').findOne({ _id: target, deletedAt: null });
    if (!head) throw new NotFoundException('Договор не найден');
    await this.incomes.assertCanChange(cur.orderId, actor);
    await this.incomes.assertCanChange(target, actor);
    const [deps] = await this.depsOfLines([cur]);
    if (deps.blockers.length) throw new ConflictException({ statusCode: 409, message: `Позицию нельзя перенести: ${deps.blockers.join('; ')}`, details: deps });
    const last = await this.coll('incomes').find({ orderId: target, deletedAt: null }).sort({ lineNo: -1 }).limit(1).toArray();
    const now = new Date();
    const set: Doc = {
      orderId: target, lineNo: (Number(last[0]?.lineNo) || 0) + 1, editedInApp: true, updatedAt: now,
      orderNo: head.orderNo, customer: head.customer, companyId: head.companyId, paymentForm: head.paymentForm, shipDate: head.shipDate,
    };
    const unset: Record<string, ''> = {};
    for (const k of Object.keys(set)) if (set[k] === undefined || set[k] === null) { delete set[k]; if (!['orderId', 'lineNo'].includes(k)) unset[k] = ''; }
    if (s(head.productionNo).trim() && cur.productId) set.matchStatus = 'auto'; // в производственном заказе сопоставление подтверждают заново
    const session = await this.connection.startSession();
    try {
      await session.withTransaction(async () => {
        await this.coll('incomes').updateOne({ _id: oidOf(cur._id) }, { $set: set, ...(Object.keys(unset).length ? { $unset: unset } : {}) }, { session });
        await this.coll('designtasks').updateMany({ incomeId: cur._id }, { $set: { orderId: target } }, { session });
        await this.coll('worktasks').updateMany({ incomeId: cur._id }, { $set: { orderId: target } }, { session });
        await this.coll('reservations').updateMany({ salesOrderLineId: cur._id }, { $set: { salesOrderId: target } }, { session });
        await this.coll('supplyrequests').updateMany({ salesOrderLineId: cur._id }, { $set: { salesOrderId: target } }, { session });
        await this.coll('productpassports').updateMany({ incomeId: cur._id }, { $set: { salesOrderId: target, ...(head.orderNo ? { orderNo: head.orderNo } : {}), ...(head.customer ? { customerName: head.customer } : {}) } }, { session });
      });
    } finally { await session.endSession(); }
    return { ...(await this.incomes.get(id)), movedFrom: cur.orderId ? s(cur.orderId) : null };
  }
}
