import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import type { ClientSession, Connection, Model } from 'mongoose';
import { Types } from 'mongoose';
import { parseSheetDate } from '../../common/date-parse';
import { escapeRe, oid } from '../../common/list-query';
import { NotificationsService } from '../notifications/notifications.service';
import { MaterialPriceService } from '../material/material-price.service';
import type { PriceSource } from '../material/material-price.schema';
import { PatchInvoiceDto } from './dto-invoice';
import { ISSUED_GATE, ORDERED_GATE, missing, normInvoiceNo, splitAmount } from './supply-invoice-rules';
import { SupplyInvoice, SupplyInvoiceDocument } from './supply-invoice.schema';
import { SupplyRequest, SupplyRequestDocument } from './supply-request.schema';
import { SupplyService } from './supply.service';

type Lean = Record<string, unknown>;

/**
 * Счета поставщиков (`supplyinvoices`). Строки счёта — заявки с `invoiceId`; поля счёта в заявках
 * (invoiceNo, invoiceDate, priceHint, companyId, paid, paidAt) — копия, пишется здесь, в одной транзакции со счётом.
 * Ворота — supply-invoice-rules.ts. Старый PATCH /supply/requests не затронут.
 */
@Injectable()
export class SupplyInvoiceService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(SupplyInvoice.name) private readonly model: Model<SupplyInvoiceDocument>,
    @InjectModel(SupplyRequest.name) private readonly requests: Model<SupplyRequestDocument>,
    private readonly supply: SupplyService,
    private readonly prices: MaterialPriceService,
    private readonly notices: NotificationsService,
  ) {}

  private async tx<T>(fn: (s: ClientSession) => Promise<T>): Promise<T> {
    const session = await this.connection.startSession();
    try {
      let out!: T;
      await session.withTransaction(async () => { out = await fn(session); });
      return out;
    } finally { await session.endSession(); }
  }

  private async orgNames(ids: unknown[]) {
    const list = ids.filter(Boolean).map((i) => new Types.ObjectId(String(i)));
    const docs = list.length ? await this.connection.db!.collection('organizations').find({ _id: { $in: list } }, { projection: { name: 1, shortName: 1 } }).toArray() : [];
    return new Map(docs.map((d) => [String(d._id), String(d.shortName || d.name)]));
  }

  private async load(id: string): Promise<Lean> {
    const inv = await this.model.findOne({ _id: oid(id, 'счёта'), deletedAt: null }).lean().exec();
    if (!inv) throw new NotFoundException('Счёт не найден');
    return inv as Lean;
  }

  /** Договоры поставщиков по id: contractId → { no, date, status } (удалённые не показываем). */
  private async contractInfo(ids: unknown[]) {
    const list = [...new Set(ids.filter(Boolean).map(String))].map((i) => new Types.ObjectId(i));
    const docs = list.length ? await this.connection.db!.collection('suppliercontracts').find({ _id: { $in: list }, deletedAt: null }, { projection: { no: 1, date: 1 } }).toArray() : [];
    return new Map(docs.map((d) => [String(d._id), { contractNo: (d.no as string) ?? null, contractDate: (d.date as Date) ?? null }]));
  }

  /** Договор для счёта: существует, не удалён, того же поставщика; закрытый — только если уже выбран. */
  private async checkContract(contractId: string, supplierId: unknown, current: unknown): Promise<Types.ObjectId> {
    const c = await this.connection.db!.collection('suppliercontracts').findOne({ _id: oid(contractId, 'договора'), deletedAt: null });
    if (!c) throw new BadRequestException('Договор не найден');
    if (!supplierId || String(c.supplierId) !== String(supplierId)) throw new BadRequestException('Договор другого поставщика');
    if (c.status === 'closed' && String(current ?? '') !== String(c._id)) throw new BadRequestException('Договор закрыт — выберите действующий');
    return c._id;
  }

  /** Номера заказов/договоров по заявкам: salesOrderId → { orderNo, productionNo, contractNo }. */
  private async orderInfo(reqs: Lean[]) {
    const ids = [...new Set(reqs.map((r) => r.salesOrderId).filter(Boolean).map(String))].map((i) => new Types.ObjectId(i));
    const docs = ids.length ? await this.connection.db!.collection('salesorders').find({ _id: { $in: ids } }, { projection: { orderNo: 1, productionNo: 1, contractNo: 1 } }).toArray() : [];
    return new Map(docs.map((d) => [String(d._id), { orderNo: (d.orderNo as string) ?? null, productionNo: (d.productionNo as string) ?? null, contractNo: (d.contractNo as string) ?? null }]));
  }

  /** Список счетов: статус (через запятую), поставщик, поиск по № / поставщику, период по дате счёта; sum — по всем найденным. */
  async list(q: Record<string, string | undefined>) {
    const page = Math.max(1, Number(q.page) || 1);
    const limit = Math.min(200, Math.max(1, Number(q.limit) || 50));
    const f: Lean = { deletedAt: null };
    const st = (q.status ?? '').split(',').map((x) => x.trim()).filter(Boolean);
    if (st.length) f.status = { $in: st };
    if (q.supplierId) f.supplierId = oid(q.supplierId, 'поставщика');
    if (q.contract) {
      if (!['none', 'has'].includes(q.contract)) throw new BadRequestException('Договор: none (без договора) или has (с договором)');
      f.contractId = q.contract === 'none' ? null : { $ne: null };
    }
    if (q.q?.trim()) { const re = new RegExp(escapeRe(q.q.trim()), 'i'); f.$or = [{ no: re }, { supplierName: re }]; }
    const range: Lean = {};
    if (q.from) { const d = parseSheetDate(q.from); if (!d) throw new BadRequestException('Дата «с» — в формате ГГГГ-ММ-ДД'); range.$gte = d; }
    if (q.to) { const d = parseSheetDate(q.to); if (!d) throw new BadRequestException('Дата «по» — в формате ГГГГ-ММ-ДД'); range.$lt = new Date(d.getTime() + 86400000); }
    if (Object.keys(range).length) f.date = range;
    const [rows, total, agg] = await Promise.all([
      this.model.find(f).sort({ date: -1, createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean().exec() as Promise<Lean[]>,
      this.model.countDocuments(f).exec(),
      this.model.aggregate([{ $match: f }, { $group: { _id: null, sum: { $sum: '$amount' } } }]).exec(),
    ]);
    const reqs = rows.length ? await this.requests.find({ invoiceId: { $in: rows.map((r) => r._id) }, deletedAt: null, status: { $ne: 'cancelled' } }).lean().exec() as Lean[] : [];
    const [orders, names, contracts] = await Promise.all([this.orderInfo(reqs), this.orgNames(rows.map((r) => r.payerCompanyId)), this.contractInfo(rows.map((r) => r.contractId))]);
    const items = rows.map((r) => {
      const mine = reqs.filter((x) => String(x.invoiceId) === String(r._id));
      const nos = [...new Set(mine.map((x) => orders.get(String(x.salesOrderId))).filter(Boolean).map((o) => o!.productionNo || o!.orderNo).filter(Boolean))] as string[];
      return { id: String(r._id), no: r.no ?? null, date: r.date ?? null, amount: r.amount ?? 0, status: r.status, paidAt: r.paidAt ?? null,
        supplierId: r.supplierId ? String(r.supplierId) : null, supplierName: r.supplierName ?? null,
        payerName: r.payerCompanyId ? names.get(String(r.payerCompanyId)) ?? null : null,
        contractId: r.contractId ? String(r.contractId) : null, contractNo: contracts.get(String(r.contractId))?.contractNo ?? null, contractDate: contracts.get(String(r.contractId))?.contractDate ?? null, requestsCount: mine.length, orders: nos };
    });
    return { items, total, page, limit, sum: (agg[0]?.sum as number) ?? 0 };
  }

  /** Счёт + его заявки (с № заказа/договора), файлы с адресами, цепочка заказы → договоры. */
  async get(id: string) {
    const inv = await this.load(id);
    const [items, names, contracts] = await Promise.all([this.supply.byInvoice(inv._id as Types.ObjectId), this.orgNames([inv.payerCompanyId]), this.contractInfo([inv.contractId])]);
    const contract = contracts.get(String(inv.contractId));
    const orders = await this.orderInfo(items as Lean[]);
    const requests = (items as Lean[]).map((r) => {
      const o = r.salesOrderId ? orders.get(String(r.salesOrderId)) : undefined;
      return { ...r, orderNo: o?.orderNo ?? null, productionNo: o?.productionNo ?? null, contractNo: o?.contractNo ?? null, hasOrder: Boolean(o) };
    });
    const chain = new Map<string, { productionNo: string | null; contracts: string[] }>();
    for (const r of requests) {
      if (!r.hasOrder) continue;
      const key = r.productionNo ?? '';
      const e = chain.get(key) ?? { productionNo: r.productionNo, contracts: [] };
      const c = r.contractNo ?? r.orderNo;
      if (c && !e.contracts.includes(c)) e.contracts.push(c);
      chain.set(key, e);
    }
    const fids = (inv.fileIds as Types.ObjectId[] | undefined) ?? [];
    const photos = fids.length ? await this.connection.db!.collection('photos').find({ _id: { $in: fids } }, { projection: { storageUrl: 1, originalName: 1, originalFilename: 1, mimeType: 1, name: 1 } }).toArray() : [];
    const files = fids.map((f) => photos.find((p) => String(p._id) === String(f))).filter(Boolean).map((p) => ({ id: String(p!._id), url: String(p!.storageUrl), name: String(p!.originalFilename ?? p!.originalName ?? p!.name ?? 'Файл счёта'), mime: (p!.mimeType as string | undefined) ?? null }));
    return { ...inv, id: String(inv._id), payerName: inv.payerCompanyId ? names.get(String(inv.payerCompanyId)) ?? null : null, contractNo: contract?.contractNo ?? null, contractDate: contract?.contractDate ?? null, requests, files, orders: [...chain.values()] };
  }

  /** Принять счёт на склад: каждая неполученная заявка — через SupplyService.receive (приход на склад по умолчанию, повтор безопасен по clientUid). */
  async receive(id: string, requestIds: string[] | undefined, userId?: string) {
    const inv = await this.load(id);
    if (inv.status === 'cancelled') throw new BadRequestException('Счёт отменён');
    const lines = await this.requests.find({ invoiceId: inv._id, deletedAt: null, status: { $ne: 'cancelled' } }).sort({ num: 1, _id: 1 }).lean().exec() as Lean[];
    const label = (d: Lean) => `Заявка №${d.num ?? '—'} «${d.title ?? ''}»`;
    let todo = lines.filter((d) => d.status !== 'received');
    if (requestIds?.length) {
      const want = [...new Set(requestIds)];
      for (const w of want) {
        const d = lines.find((x) => String(x._id) === w);
        if (!d) throw new BadRequestException('Заявка не входит в этот счёт');
        if (d.status === 'received') throw new ConflictException(`${label(d)} уже принята на склад`);
      }
      todo = lines.filter((d) => want.includes(String(d._id)));
    }
    if (!todo.length) throw new ConflictException('Все позиции этого счёта уже приняты на склад');
    for (const d of todo) await this.supply.receive(String(d._id), { clientUid: `inv-${id}-${String(d._id)}` }, userId);
    return { ...(await this.get(id)), receivedCount: todo.length };
  }

  /** Заказать группой: заявки делятся по поставщику, на каждого — черновик счёта; заявки → «заказано». */
  async create(requestIds: string[], userId?: string) {
    const ids = [...new Set(requestIds)].map((i) => oid(i, 'заявки'));
    const docs = await this.requests.find({ _id: { $in: ids }, deletedAt: null }).lean().exec() as Lean[];
    if (docs.length !== ids.length) throw new NotFoundException('Часть заявок не найдена — обновите список');
    const names = await this.orgNames(docs.map((d) => d.supplierId));
    for (const d of docs) {
      const label = `Заявка №${d.num ?? '—'} «${d.title ?? ''}»`;
      if (d.invoiceId) throw new BadRequestException(`${label} уже входит в счёт`);
      if (!['requested', 'in_progress'].includes(String(d.status ?? 'requested'))) throw new BadRequestException(`${label}: заказать можно только заявку «В заказ» или «В работе»`);
      const lack = missing(ORDERED_GATE, d);
      if (lack.length) throw new BadRequestException(`${label}: не заполнено — ${lack.join(', ')}`);
    }
    const groups = new Map<string, Lean[]>();
    for (const d of docs) groups.set(String(d.supplierId), [...(groups.get(String(d.supplierId)) ?? []), d]);
    const createdBy = userId && Types.ObjectId.isValid(userId) ? new Types.ObjectId(userId) : undefined;
    const made = await this.tx(async (session) => {
      const out: string[] = [];
      for (const [sup, list] of groups) {
        const [inv] = await this.model.create([{ supplierId: new Types.ObjectId(sup), supplierName: names.get(sup), status: 'draft', fileIds: [], createdBy }], { session });
        const res = await this.requests.updateMany(
          { _id: { $in: list.map((d) => d._id) }, deletedAt: null, invoiceId: { $exists: false } },
          { $set: { invoiceId: inv._id, status: 'ordered', paid: false, editedInApp: true } }, { session }).exec();
        if (res.modifiedCount !== list.length) throw new BadRequestException('Заявки изменились, пока вы выбирали — обновите список и повторите');
        out.push(String(inv._id));
      }
      return out;
    });
    return { items: await Promise.all(made.map((i) => this.get(i))) };
  }

  /** Правка счёта; «выставлен» — только при №, дате и сумме. Копирует поля в заявки, сумму делит по строкам. */
  async update(id: string, dto: PatchInvoiceDto, actorId?: string) {
    const inv = await this.load(id);
    if (inv.status === 'paid') {
      // у оплаченного можно только прикрепить файлы счёта и привязать договор (пользователь 2026-10-29: «счёт не появляется» — файл было не добавить)
      const other = Object.entries(dto).filter(([k, v]) => v !== undefined && !['fileIds', 'contractId'].includes(k) && !(k === 'issue' && !v));
      if (other.length) throw new BadRequestException('Счёт оплачен — менять можно только файлы счёта и договор');
      return this.updatePaid(inv, dto);
    }
    if (inv.status === 'cancelled') throw new BadRequestException('Счёт отменён');
    const set: Lean = {};
    if (dto.no !== undefined) set.no = dto.no.trim() || undefined;
    if (dto.date !== undefined) {
      const d = parseSheetDate(dto.date);
      if (dto.date && !d) throw new BadRequestException('Дата счёта — в формате ДД.ММ.ГГГГ');
      set.date = d;
    }
    if (dto.amount !== undefined) set.amount = dto.amount;
    if (dto.fileIds !== undefined) set.fileIds = dto.fileIds.map((i) => oid(i, 'файла'));
    if (dto.payerCompanyId !== undefined) {
      if (dto.payerCompanyId) {
        const org = await this.connection.db!.collection('organizations').findOne({ _id: oid(dto.payerCompanyId, 'плательщика'), deletedAt: null });
        if (!org) throw new BadRequestException('Плательщик не найден среди организаций');
        set.payerCompanyId = org._id;
      } else set.payerCompanyId = undefined;
    }
    if (dto.supplierId !== undefined) {
      if (inv.status === 'paid') throw new BadRequestException('Счёт оплачен — поставщика не сменить');
      const org = await this.connection.db!.collection('organizations').findOne({ _id: oid(dto.supplierId, 'поставщика'), deletedAt: null });
      if (!org) throw new BadRequestException('Поставщик не найден среди организаций');
      set.supplierId = org._id;
      set.supplierName = String(org.shortName || org.name || '');
    }
    const warnings: string[] = [];
    const supplierNow = set.supplierId ?? inv.supplierId;
    if (dto.contractId) set.contractId = await this.checkContract(dto.contractId, supplierNow, inv.contractId);
    else if (dto.contractId === '') set.contractId = undefined;
    else if (set.supplierId && inv.contractId && String(set.supplierId) !== String(inv.supplierId)) {
      set.contractId = undefined;
      warnings.push('Договор снят: он относится к прежнему поставщику. Выберите договор нового поставщика');
    }
    const noNow = 'no' in set ? set.no : inv.no;
    if ((dto.no !== undefined || set.supplierId) && noNow && supplierNow) {
      const key = normInvoiceNo(noNow);
      const same = await this.model.find({ supplierId: supplierNow, deletedAt: null, status: { $ne: 'cancelled' }, _id: { $ne: inv._id } }).lean().exec() as Lean[];
      const dup = same.find((x) => normInvoiceNo(x.no) === key);
      if (dup) {
        if (dup.status === 'paid') throw new ConflictException(`Счёт № ${String(noNow)} у этого поставщика уже оплачен (сумма ${Number(dup.amount) || 0}). Проверьте номер или добавьте позицию к нему вручную`);
        return this.mergeInto(dup, inv, set, dto, actorId, [...warnings, `Счёт № ${String(dup.no)} у этого поставщика уже есть — позиции добавлены в него`]);
      }
    }
    const next = { ...inv, ...set };
    if (dto.issue) {
      const lack = missing(ISSUED_GATE, next);
      if (lack.length) throw new BadRequestException(`Счёт нельзя отметить выставленным — не заполнено: ${lack.join(', ')}`);
      set.status = 'issued';
    }
    const status = (set.status ?? inv.status) as string;
    await this.tx(async (session) => {
      const $set: Lean = {}; const $unset: Lean = {};
      for (const [k, v] of Object.entries(set)) (v === undefined ? $unset : $set)[k] = v === undefined ? '' : v;
      await this.model.updateOne({ _id: inv._id }, { ...(Object.keys($set).length ? { $set } : {}), ...(Object.keys($unset).length ? { $unset } : {}) }, { session }).exec();
      if (status === 'issued') {
        await this.copyToRequests({ ...next, status }, session);
        await this.recordPrices({ ...next, status }, 'invoice_issued', session);
      } else if (set.supplierId) {
        await this.requests.updateMany({ invoiceId: inv._id, deletedAt: null }, { $set: { supplierId: set.supplierId, editedInApp: true } }, { session }).exec();
      }
    });
    if (status === 'issued' && inv.status !== 'issued') {
      const what = [next.no ? `№${next.no}` : '', next.supplierName ? `от ${next.supplierName}` : ''].filter(Boolean).join(' ');
      await this.notices.toRoles(['admin', 'director', 'accountant'], { type: 'invoice_awaiting_payment', text: `Счёт ${what || 'без номера'} выставлен — ждёт оплаты`, href: `#requests?tab=invoices&open=${id}` }, actorId);
    }
    return warnings.length ? { ...(await this.get(id)), warnings } : this.get(id);
  }

  /** Склейка дубля: заявки текущего счёта → найденный (сумма складывается, файлы объединяются), текущий удаляется с mergedInto. */
  private async mergeInto(dup: Lean, inv: Lean, set: Lean, dto: PatchInvoiceDto, actorId: string | undefined, warnings: string[]) {
    const mine = { ...inv, ...set };
    const a = dup.amount as number | undefined; const b = mine.amount as number | undefined;
    const amount = a != null && b != null ? Math.round((a + b) * 100) / 100 : a ?? b;
    const ids = new Map<string, Types.ObjectId>();
    for (const f of [...((dup.fileIds as Types.ObjectId[]) ?? []), ...((mine.fileIds as Types.ObjectId[]) ?? [])]) ids.set(String(f), f);
    const patch: Lean = { fileIds: [...ids.values()], amount };
    for (const k of ['contractId', 'payerCompanyId', 'date']) if (!dup[k] && mine[k]) patch[k] = mine[k];
    const next = { ...dup, ...patch };
    if (dto.issue) {
      const lack = missing(ISSUED_GATE, next);
      if (lack.length) throw new BadRequestException(`Счёт нельзя отметить выставленным — не заполнено: ${lack.join(', ')}`);
      patch.status = 'issued';
    }
    const status = (patch.status ?? dup.status) as string;
    await this.tx(async (session) => {
      await this.requests.updateMany({ invoiceId: inv._id, deletedAt: null }, { $set: { invoiceId: dup._id, supplierId: dup.supplierId, editedInApp: true } }, { session }).exec();
      const $set: Lean = {}; const $unset: Lean = {};
      for (const [k, v] of Object.entries(patch)) (v === undefined ? $unset : $set)[k] = v === undefined ? '' : v;
      await this.model.updateOne({ _id: dup._id }, { ...(Object.keys($set).length ? { $set } : {}), ...(Object.keys($unset).length ? { $unset } : {}) }, { session }).exec();
      await this.model.updateOne({ _id: inv._id }, { $set: { deletedAt: new Date(), mergedInto: dup._id } }, { session }).exec();
      if (status === 'issued') {
        await this.copyToRequests({ ...next, status }, session);
        if (dup.status !== 'issued') await this.recordPrices({ ...next, status }, 'invoice_issued', session);
      }
    });
    if (status === 'issued' && dup.status !== 'issued') {
      const what = [next.no ? `№${String(next.no)}` : '', next.supplierName ? `от ${String(next.supplierName)}` : ''].filter(Boolean).join(' ');
      await this.notices.toRoles(['admin', 'director', 'accountant'], { type: 'invoice_awaiting_payment', text: `Счёт ${what || 'без номера'} выставлен — ждёт оплаты`, href: `#requests?tab=invoices&open=${String(dup._id)}` }, actorId);
    }
    return { ...(await this.get(String(dup._id))), warnings };
  }

  /** Копия полей счёта в заявки: № и дата, плательщик, сумма — пропорционально lineTotal (иначе priceHint), остаток копеек — последней. */
  /** Оплаченный счёт: только файлы (добавить/убрать) и договор. */
  private async updatePaid(inv: Lean, dto: PatchInvoiceDto) {
    const $set: Lean = {}; const $unset: Lean = {};
    if (dto.fileIds !== undefined) $set.fileIds = dto.fileIds.map((i) => oid(i, 'файла'));
    if (dto.contractId) $set.contractId = await this.checkContract(dto.contractId, inv.supplierId, inv.contractId);
    else if (dto.contractId === '') $unset.contractId = '';
    if (Object.keys($set).length || Object.keys($unset).length) {
      await this.model.updateOne({ _id: inv._id }, { ...(Object.keys($set).length ? { $set } : {}), ...(Object.keys($unset).length ? { $unset } : {}) }).exec();
    }
    return this.get(String(inv._id));
  }

  private async copyToRequests(inv: Lean, session: ClientSession) {
    const lines = await this.requests.find({ invoiceId: inv._id, deletedAt: null }).sort({ num: 1, _id: 1 }).session(session).lean().exec() as Lean[];
    const shares = splitAmount(Number(inv.amount) || 0, lines.map((l) => Number(l.lineTotal ?? l.priceHint) || 0));
    const common = { invoiceNo: inv.no, invoiceDate: inv.date, editedInApp: true, ...(inv.supplierId ? { supplierId: inv.supplierId } : {}), ...(inv.payerCompanyId ? { companyId: inv.payerCompanyId } : {}) };
    for (let i = 0; i < lines.length; i++) {
      await this.requests.updateOne({ _id: lines[i]._id }, { $set: { ...common, priceHint: shares[i] } }, { session }).exec();
    }
  }

  /** Строка истории цен на каждую заявку счёта с materialId: сумма строки (после деления) / количество. */
  private async recordPrices(inv: Lean, source: PriceSource, session: ClientSession) {
    const lines = await this.requests.find({ invoiceId: inv._id, deletedAt: null, status: { $ne: 'cancelled' }, materialId: { $exists: true, $ne: null } }).session(session).lean().exec() as Lean[];
    for (const l of lines) {
      await this.prices.record({
        materialId: l.materialId as Types.ObjectId, supplierId: inv.supplierId as Types.ObjectId | undefined, supplierName: inv.supplierName as string | undefined,
        lineTotalWithVat: Number(l.priceHint) || 0, qty: Number(l.qty) || 0, unit: l.unit as string | undefined, vatRate: inv.vatRate as number | undefined,
        date: (inv.date as Date | undefined) ?? new Date(), source, invoiceId: inv._id as Types.ObjectId, requestId: l._id as Types.ObjectId,
        salesOrderId: l.salesOrderId as Types.ObjectId | undefined, createdBy: inv.createdBy as Types.ObjectId | undefined,
      }, session);
    }
  }

  /** Оплата всего счёта: нужен «выставлен» и плательщик. */
  async pay(id: string) {
    const inv = await this.load(id);
    if (inv.status === 'paid') throw new BadRequestException('Счёт уже оплачен');
    if (inv.status !== 'issued') throw new BadRequestException('Сначала отметьте счёт выставленным: нужны №, дата и сумма');
    if (!inv.payerCompanyId) throw new BadRequestException('Укажите, какая компания платит (плательщик)');
    const now = new Date();
    await this.tx(async (session) => {
      await this.model.updateOne({ _id: inv._id }, { $set: { status: 'paid', paidAt: now } }, { session }).exec();
      await this.requests.updateMany({ invoiceId: inv._id, deletedAt: null, status: { $ne: 'cancelled' } },
        { $set: { paid: true, paidAt: now, status: 'ordered', editedInApp: true } }, { session }).exec();
      await this.recordPrices(inv, 'invoice_paid', session);
    });
    return this.get(id);
  }

  /** Удалить счёт (мягко): оплаченный нельзя; заявки отвязываются и возвращаются в «В заказ». */
  async remove(id: string) {
    const inv = await this.load(id);
    if (inv.status === 'paid') throw new BadRequestException('Счёт оплачен — удалить нельзя');
    await this.tx(async (session) => {
      await this.requests.updateMany({ invoiceId: inv._id, deletedAt: null, status: 'ordered', paid: { $ne: true } }, { $set: { status: 'requested' } }, { session }).exec();
      await this.requests.updateMany({ invoiceId: inv._id }, { $unset: { invoiceId: '', invoiceNo: '', invoiceDate: '' }, $set: { editedInApp: true } }, { session }).setOptions({ includeSoftDeleted: true }).exec();
      await this.model.updateOne({ _id: inv._id }, { $set: { deletedAt: new Date() } }, { session }).exec();
    });
    return { id, deleted: true };
  }
}
