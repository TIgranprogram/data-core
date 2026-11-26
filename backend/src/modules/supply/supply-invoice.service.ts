import { claimStockLinks } from '../../common/order-archive/write';
import { SupplyUndatedPaymentsService } from './supply-undated-payments.service';
import { hasUndatedPayment, undatedLocked } from './undated-payment';
import { UndatedInvoicePaymentDto, RevokeUndatedInvoicePaymentDto } from './dto-invoice';
import { invoicePaymentSummaries } from './invoice-payment-summary';
import { expenseArticleMatch } from './expense-article-filter';
import { SupplyInvoicePaymentsService } from './supply-invoice-payments.service';
import { FINANCIAL_META, SOURCE_LINE_KEYS, financials, factDate, type FinancialRecord } from './invoice-financials';
import { CreateInvoicePaymentDto, ReceiveInvoiceDto, VoidInvoicePaymentDto } from './dto-invoice';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import type { ClientSession, Connection, Model } from 'mongoose';
import { Types } from 'mongoose';
import type { StockScope } from '../../common/stock-scope';
import { canSeeMoney } from '../../common/roles-hierarchy';
import { docScopeMatch } from '../../common/supply-scope';
import { parseSheetDate } from '../../common/date-parse';
import { escapeRe, oid } from '../../common/list-query';
import { adminOverride, assertAdminActor, isAdminActor, overrideConfirm, overrideReason, type OverridePlan, type OverrideActor } from '../../common/admin-override';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { MaterialPriceService } from '../material/material-price.service';
import type { PriceSource } from '../material/material-price.schema';
import { PatchInvoiceDto, PatchInvoiceLineDto } from './dto-invoice';
import { ISSUED_GATE, ORDERED_GATE, missing, normInvoiceNo } from './supply-invoice-rules';
import { guardLegacyInvoiceIdentity, INVOICE_IDENTITY_FIELDS, lockInvoiceIdentity } from './supply-invoice-identity';
import { SupplyInvoice, SupplyInvoiceDocument } from './supply-invoice.schema';
import { SupplyRequest, SupplyRequestDocument } from './supply-request.schema';
import { SupplyService } from './supply.service';

type Lean = Record<string, unknown>;

/**
 * Счета поставщиков (`supplyinvoices`). Строки счёта — заявки с `invoiceId`; поля счёта в заявках
 * (invoiceNo, invoiceDate, priceHint, companyId, paid, paidAt) — копия, пишется здесь, в одной транзакции со счётом.
 * Ворота — supply-invoice-rules.ts; финансовые поля legacy PATCH /supply/requests отдельно защищены SupplyService.
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
    @Optional() private readonly audit?: AuditService,
    @Optional() private readonly ledger?: SupplyInvoicePaymentsService,
    @Optional() private readonly undated?: SupplyUndatedPaymentsService,
  ) {}

  private async claimRequests(filter: Record<string, unknown>, session: ClientSession) {
    const rows = await this.requests.find(filter, { salesOrderId: 1, salesOrderLineId: 1 }).setOptions({ includeSoftDeleted: true }).session(session).lean().exec();
    await claimStockLinks(this.connection.db!, session, rows);
  }

  private async tx<T>(fn: (s: ClientSession) => Promise<T>): Promise<T> {
    const session = await this.connection.startSession();
    try {
      let out!: T;
      await session.withTransaction(async () => { out = await fn(session); });
      return out;
    } finally { await session.endSession(); }
  }

  private async recheckIntakeIdentity(inv: Lean, changes: Lean, reason: string | undefined, session: ClientSession) {
    if (!INVOICE_IDENTITY_FIELDS.some(field => field in changes)) return;
    await lockInvoiceIdentity(this.connection, session);
    const fresh = await this.model.findOne({ _id: inv._id, deletedAt: null }).session(session).lean().exec() as Lean | null;
    if (!fresh || fresh.version !== inv.version) throw new ConflictException('Реквизиты счёта изменились — обновите карточку');
    return guardLegacyInvoiceIdentity(this.connection, fresh, changes, reason, session);
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

  /**
   * Финансовые правки и добавление строк разрешены до приёмки; хотя бы одна принятая строка
   * фиксирует весь счёт. Оплата сама по себе не блокирует редактирование до приёмки.
   */
  private async lockReason(inv: Lean): Promise<string | null> {
    if (hasUndatedPayment(inv)) return 'Оплата подтверждена без даты — сначала заполните дату или снимите подтверждение';
    if (inv.paymentAccountingVersion === 1 && Number(inv.paidAmount) > 0) return 'По счёту есть фактические платежи — финансовая база зафиксирована';
    if (inv.receiptBoundaryAt) return 'По счёту уже началась приёмка на склад — финансовые поля заблокированы';
    if (typeof this.requests.countDocuments === 'function') {
      const received = await this.requests.countDocuments({ invoiceId: inv._id, deletedAt: null, status: 'received' }).exec();
      if (Number(received) > 0) return 'По счёту уже есть приёмка на склад — финансовые поля заблокированы';
    }
    return null;
  }

  /** Пишет тот же invoice-документ в транзакции, что и первая приёмка; Mongo конфликт сериализует операции. */
  private async touchFinancialInvoice(invoiceId: unknown, session: ClientSession, expectedVersion?: unknown) {
    const result = await this.model.updateOne(
      { _id: invoiceId, deletedAt: null, 'undatedPaymentEvidence.state': { $ne: 'pending' }, ...(expectedVersion !== undefined ? { version: Number(expectedVersion) } : {}), $and: [{ $or: [{ receiptBoundaryAt: null }, { receiptBoundaryAt: { $exists: false } }] }, { $or: [{ paymentAccountingVersion: { $ne: 1 } }, { paidAmount: { $lte: 0 } }] }] },
      { $inc: { version: 1 } }, { session },
    ).exec();
    if (!result.matchedCount) throw new BadRequestException('По счёту уже началась приёмка — финансовые поля заблокированы');
  }

  private async paymentLines(inv: Lean, session: ClientSession) {
    const lines = await this.requests.find({ invoiceId: inv._id, deletedAt: null, status: { $ne: 'cancelled' } }).session(session).lean().exec() as Lean[];
    return lines.map((line) => ({
      requestId: line._id as Types.ObjectId, lineAmount: Number(line.priceHint) || 0, qty: Number(line.qty) || 0,
      ...(line.companyId ? { companyId: line.companyId as Types.ObjectId } : {}),
      ...(line.categoryId ? { categoryId: line.categoryId as Types.ObjectId } : {}),
      ...(line.supplierId ? { supplierId: line.supplierId as Types.ObjectId } : {}),
      ...(line.supplierName ? { supplierName: String(line.supplierName) } : {}),
      ...(line.salesOrderId ? { salesOrderId: line.salesOrderId as Types.ObjectId } : {}),
      salesOrderLineId: (line.salesOrderLineId as Types.ObjectId | undefined) ?? null,
      ...(line.costCenter ? { costCenter: String(line.costCenter) } : {}),
      ...(line.title ? { title: String(line.title) } : {}), ...(line.num !== undefined ? { num: line.num as number | string } : {}),
      ...(inv.no ? { invoiceNo: String(inv.no) } : {}),
    }));
  }

  private async recordPaymentAdjustment(inv: Lean, session: ClientSession, input: {
    reason?: string; actorId?: string; operation: 'line_edit' | 'lines_added' | 'line_removed'; beforeAmount: number; afterAmount: number; requestIds: Types.ObjectId[];
  }) {
    if (inv.status !== 'paid' && !(inv.paymentAccountingVersion === 1 && Number(inv.paidAmount) > 0)) return;
    const reason = input.reason?.trim()
      || (input.operation === 'lines_added' ? 'Добавление позиций' : '')
      || (input.operation === 'line_edit' ? 'Изменение позиции' : '');
    if (!reason) throw new BadRequestException('Для изменения оплаченного счёта укажите причину сверки/корректировки');
    const by = input.actorId && Types.ObjectId.isValid(input.actorId) ? new Types.ObjectId(input.actorId) : undefined;
    await this.model.updateOne({ _id: inv._id }, { $push: { paymentAdjustments: {
      at: new Date(), ...(by ? { by } : {}), reason, operation: input.operation,
      beforeAmount: input.beforeAmount, afterAmount: input.afterAmount,
      delta: Math.round((input.afterAmount - input.beforeAmount) * 100) / 100, requestIds: input.requestIds,
    } } }, { session }).exec();
  }

  /** Сумма строк счёта: `priceHint` — сумма строки (не цена за единицу), отменённые строки не считаем. */
  private async linesSum(inv: Lean): Promise<number> {
    const lines = this.requests.find ? await this.requests.find({ invoiceId: inv._id, deletedAt: null, status: { $ne: 'cancelled' } }).lean().exec() as Lean[] : [];
    return Math.round(lines.reduce((t, l) => t + (Number(l.priceHint) || 0), 0) * 100) / 100;
  }

  /** Инвариант счёта: amount = сумма priceHint всех строк. Пересчёт — только в транзакции. */
  private async recalcAmount(inv: Lean, session: ClientSession): Promise<number> {
    const lines = await this.requests.find({ invoiceId: inv._id, deletedAt: null, status: { $ne: 'cancelled' } }).session(session).lean().exec() as Lean[];
    const amount = Math.round(lines.reduce((t, l) => t + (Number(l.priceHint) || 0), 0) * 100) / 100;
    if (Number(inv.amount ?? -1) !== amount) await this.model.updateOne({ _id: inv._id }, { $set: { amount }, $inc: { version: 1 } }, { session }).exec();
    return amount;
  }

  /** Строки счёта (для явного объединения): без удалённых и отменённых. */
  private async linesOf(inv: Lean, session?: ClientSession): Promise<Lean[]> {
    const q = this.requests.find({ invoiceId: inv._id, deletedAt: null, status: { $ne: 'cancelled' } });
    return (session ? await q.session(session).lean().exec() : await q.lean().exec()) as Lean[];
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
  /** Склады (WZ): какие из заявок видны в доступе (null — все). */
  private async visibleRequests(ids: Types.ObjectId[], scope: StockScope | null): Promise<Set<string> | null> {
    if (!scope) return null;
    if (!ids.length) return new Set();
    const sc = await docScopeMatch(this.connection, scope);
    return new Set((await this.requests.distinct('_id', { _id: { $in: ids }, ...sc }).exec()).map(String));
  }

  /** Склады (WZ): менять счёт можно, только если все его заявки из своего склада, иначе 403. */
  async assertWhole(id: string, scope: StockScope | null, requireVisibleLine = false): Promise<void> {
    if (!scope) return;
    const ids = await this.requests.distinct('_id', { invoiceId: oid(id, 'счёта'), deletedAt: null }).exec() as Types.ObjectId[];
    const vis = await this.visibleRequests(ids, scope);
    if (requireVisibleLine && !vis?.size) throw new ForbiddenException('Этот счёт не из вашего склада');
    if (vis && ids.some((x) => !vis.has(String(x)))) throw new ForbiddenException('В этом счёте есть заявки не из вашего склада');
  }

  /** Склады (WZ): заявки для нового счёта — только из своего склада. */
  async assertRequests(requestIds: string[], scope: StockScope | null): Promise<void> {
    if (!scope) return;
    const ids = [...new Set(requestIds)].filter((x) => Types.ObjectId.isValid(x)).map((x) => new Types.ObjectId(x));
    const vis = await this.visibleRequests(ids, scope);
    if (vis && ids.some((x) => !vis.has(String(x)))) throw new ForbiddenException('Среди заявок есть не из вашего склада');
  }

  /** Склады (WZ): итог по фильтру считается по видимым строкам (смешанный счёт — только своя часть), как amount в списке. */
  private async scopedSum(f: Lean, scope: StockScope): Promise<number> {
    const invs = await this.model.find(f).select('amount').lean().exec() as Lean[];
    if (!invs.length) return 0;
    const all = await this.requests.find({ invoiceId: { $in: invs.map((i) => i._id) }, deletedAt: null, status: { $ne: 'cancelled' } }).lean().exec() as Lean[];
    const vis = await this.visibleRequests(all.map((x) => x._id as Types.ObjectId), scope);
    const by = new Map<string, { all: number; mine: number; sum: number }>();
    for (const x of all) {
      const k = String(x.invoiceId); const e = by.get(k) ?? { all: 0, mine: 0, sum: 0 };
      e.all++; if (!vis || vis.has(String(x._id))) { e.mine++; e.sum += Number(x.priceHint) || 0; }
      by.set(k, e);
    }
    return invs.reduce((t, i) => { const e = by.get(String(i._id)); return t + (e && e.mine < e.all ? e.sum : Number(i.amount) || 0); }, 0);
  }

  async list(q: Record<string, string | undefined>, scope: StockScope | null = null) {
    const page = Math.max(1, Number(q.page) || 1);
    const limit = Math.min(200, Math.max(1, Number(q.limit) || 50));
    const f: Lean = { deletedAt: null };
    if (q.needsPaymentDate === '1') f['undatedPaymentEvidence.state'] = 'pending';
    const st = (q.status ?? '').split(',').map((x) => x.trim()).filter(Boolean);
    if (st.length) f.status = { $in: st };
    // фильтр «Поставщик» на вкладке «Счета» шлёт название из справочника (аудит 2026-11-06 №13) — id тоже принимаем
    if (q.supplierId) {
      if (Types.ObjectId.isValid(q.supplierId) && /^[0-9a-f]{24}$/i.test(q.supplierId)) f.supplierId = new Types.ObjectId(q.supplierId);
      else f.supplierName = new RegExp('^' + escapeRe(q.supplierId.trim()) + '$', 'i');
    }
    if (q.contract) {
      if (!['none', 'has'].includes(q.contract)) throw new BadRequestException('Договор: none (без договора) или has (с договором)');
      f.contractId = q.contract === 'none' ? null : { $ne: null };
    }
    if (q.q?.trim()) { const re = new RegExp(escapeRe(q.q.trim()), 'i'); f.$or = [{ no: re }, { supplierName: re }]; }
    const range: Lean = {};
    if (q.from) { const d = parseSheetDate(q.from); if (!d) throw new BadRequestException('Дата «с» — в формате ГГГГ-ММ-ДД'); range.$gte = d; }
    if (q.to) { const d = parseSheetDate(q.to); if (!d) throw new BadRequestException('Дата «по» — в формате ГГГГ-ММ-ДД'); range.$lt = new Date(d.getTime() + 86400000); }
    if (Object.keys(range).length) f.date = range;
    if (scope || q.articleId) {
      // Наличие подходящей видимой строки отбирает весь счёт; итог не режется статьёй.
      const conditions: Lean[] = [];
      if (scope) conditions.push(await docScopeMatch(this.connection, scope));
      if (q.articleId) conditions.push(await expenseArticleMatch(this.connection, q.articleId));
      f._id = { $in: await this.requests.distinct('invoiceId', { invoiceId: { $ne: null }, deletedAt: null, status: { $ne: 'cancelled' }, $and: conditions }).exec() };
    }
    const [rows, total, agg] = await Promise.all([
      this.model.find(f).sort({ date: -1, createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean().exec() as Promise<Lean[]>,
      this.model.countDocuments(f).exec(),
      this.model.aggregate([{ $match: f }, { $group: { _id: null, sum: { $sum: '$amount' } } }]).exec(),
    ]);
    const allReqs = rows.length ? await this.requests.find({ invoiceId: { $in: rows.map((r) => r._id) }, deletedAt: null, status: { $ne: 'cancelled' } }).lean().exec() as Lean[] : [];
    const vis = await this.visibleRequests(allReqs.map((x) => x._id as Types.ObjectId), scope);
    const reqs = vis ? allReqs.filter((x) => vis.has(String(x._id))) : allReqs; // смешанный счёт: только свои строки, сумма по ним
    const [orders, names, contracts] = await Promise.all([this.orderInfo(reqs), this.orgNames(rows.map((r) => r.payerCompanyId)), this.contractInfo(rows.map((r) => r.contractId))]);
    const summaries = this.ledger ? await invoicePaymentSummaries(this.connection, rows.map((r) => r._id), vis ? reqs.map((r) => r._id) : undefined) : new Map();
    const byInvoice = new Map<string, Lean[]>(), allCounts = new Map<string, number>();
    for (const row of reqs) { const key = String(row.invoiceId); if (!byInvoice.has(key)) byInvoice.set(key, []); byInvoice.get(key)!.push(row); }
    for (const row of allReqs) { const key = String(row.invoiceId); allCounts.set(key, (allCounts.get(key) || 0) + 1); }
    const items = rows.map((r) => {
      const mine = byInvoice.get(String(r._id)) || [];
      const partial = mine.length < (allCounts.get(String(r._id)) || 0);
      const nos = [...new Set(mine.map((x) => orders.get(String(x.salesOrderId))).filter(Boolean).map((o) => o!.productionNo || o!.orderNo).filter(Boolean))] as string[];
      return { ...(this.ledger ? { ...this.ledger.summary(r, mine, summaries.get(String(r._id)), partial), requests: undefined } : {}), id: String(r._id), no: r.no ?? null, date: r.date ?? null, partial, amount: partial ? mine.reduce((s, x) => s + (Number(x.priceHint) || 0), 0) : r.amount ?? 0, status: r.status, paidAt: r.paidAt ?? null,
        supplierId: r.supplierId ? String(r.supplierId) : null, supplierName: r.supplierName ?? null,
        payerName: r.payerCompanyId ? names.get(String(r.payerCompanyId)) ?? null : null,
        contractId: r.contractId ? String(r.contractId) : null, contractNo: contracts.get(String(r.contractId))?.contractNo ?? null, contractDate: contracts.get(String(r.contractId))?.contractDate ?? null, requestsCount: mine.length, orders: nos };
    });
    const sum = scope ? await this.scopedSum(f, scope) : (agg[0]?.sum as number) ?? 0;
    return { items, total, page, limit, sum };
  }

  /** Счёт + его заявки (с № заказа/договора), файлы с адресами, цепочка заказы → договоры. */
  async get(id: string, scope: StockScope | null = null) {
    const inv = await this.load(id);
    const [all, names, contracts] = await Promise.all([this.supply.byInvoice(inv._id as Types.ObjectId), this.orgNames([inv.payerCompanyId]), this.contractInfo([inv.contractId])]);
    const vis = await this.visibleRequests((all as Lean[]).map((x) => new Types.ObjectId(String(x._id ?? x.id))), scope);
    const items = vis ? (all as Lean[]).filter((x) => vis.has(String(x._id ?? x.id))) : all;
    if (vis && !items.length) throw new ForbiddenException('Этот счёт не из вашего склада');
    const partial = items.length < all.length;
    const contract = contracts.get(String(inv.contractId));
    const orders = await this.orderInfo(items as Lean[]);
    const requests = (items as Lean[]).map((r) => {
      const o = r.salesOrderId ? orders.get(String(r.salesOrderId)) : undefined;
      const qty = Number(r.qty) || 0;
      const lineAmount = Number(r.priceHint) || 0;
      return { ...r, unitPrice: qty > 0 ? Math.round((lineAmount / qty) * 100) / 100 : null, lineAmount,
        orderNo: o?.orderNo ?? null, productionNo: o?.productionNo ?? null, contractNo: o?.contractNo ?? null, hasOrder: Boolean(o) };
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
    const evidenceIds = !partial ? ((inv.undatedPaymentEvidence as { fileIds?: Types.ObjectId[] } | undefined)?.fileIds || []) : [];
    const allFileIds = [...fids, ...evidenceIds];
    const photos = allFileIds.length ? await this.connection.db!.collection('photos').find({ _id: { $in: allFileIds }, deletedAt: null }, { projection: { storageUrl: 1, originalName: 1, originalFilename: 1, mimeType: 1, name: 1 } }).toArray() : [];
    const filesFor = (ids: Types.ObjectId[]) => ids.map((f) => photos.find((p) => String(p._id) === String(f))).filter(Boolean).map((p) => ({ id: String(p!._id), url: String(p!.storageUrl), name: String(p!.originalFilename ?? p!.originalName ?? p!.name ?? 'Файл счёта'), mime: (p!.mimeType as string | undefined) ?? null }));
    const files = filesFor(fids);
    const visibleIds = vis ? requests.map((r) => oid(String((r as Lean)._id || (r as Lean).id), 'заявки')) : undefined;
    const [summaries, facts] = this.ledger ? await Promise.all([invoicePaymentSummaries(this.connection, [inv._id], visibleIds), this.ledger.facts([inv._id], 100, visibleIds)]) : [new Map(), []];
    const financial = this.ledger ? this.ledger.present(inv, requests, facts, partial, summaries.get(String(inv._id))) : {};
    if (!partial && financial.undatedPaymentEvidence) financial.undatedPaymentEvidence = { ...financial.undatedPaymentEvidence, files: filesFor(evidenceIds) };
    return { ...inv, ...financial, partial, ...(partial ? { amount: (items as Lean[]).reduce((s, x) => s + (Number(x.priceHint) || 0), 0) } : {}), id: String(inv._id), payerName: inv.payerCompanyId ? names.get(String(inv.payerCompanyId)) ?? null : null, contractNo: contract?.contractNo ?? null, contractDate: contract?.contractDate ?? null, requests: financial.requests ?? requests, files, orders: [...chain.values()] };
  }

  /** Обычный приход или прямая поставка выбранных строк с явным назначением. */
  async receive(id: string, requestIds: string[] | undefined, userId?: string, target: ReceiveInvoiceDto = {}, scope: StockScope | null = null) {
    const { directOrderId, directCostCenter, directCostObject } = target;
    if (directOrderId && directCostCenter) throw new BadRequestException("Укажите заказ или направление затрат");
    if (directCostObject != null && !directCostCenter) throw new BadRequestException("Укажите направление затрат для объекта");
    if (directOrderId || directCostCenter) {
      const destination = directOrderId ? { directOrderId } as const : { directCostCenter: directCostCenter!, directCostObject } as const;
      const receivedCount = await this.supply.receiveInvoiceDirect(id, requestIds || [], destination, userId, scope);
      return { ...(await this.get(id, scope)), receivedCount };
    }
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
    for (const d of todo) {
      // после отмены прихода ключ меняется (число отменённых), иначе новый приём принят бы за повтор старого
      const n = await this.connection.db!.collection('stockmovements').countDocuments({ documentRef: `SupplyRequest:${String(d._id)}`, cancelledAt: { $ne: null } });
      await this.supply.receive(String(d._id), { clientUid: `inv-${id}-${String(d._id)}${n ? '-' + n : ''}` }, userId, scope);
    }
    return { ...(await this.get(id, scope)), receivedCount: todo.length };
  }

  /** Заказать группой: заявки делятся по поставщику, на каждого — черновик счёта; заявки → «заказано». */
  async create(requestIds: string[], userId?: string) {
    const ids = [...new Set(requestIds)].map((i) => oid(i, 'заявки'));
    const docs = await this.requests.find({ _id: { $in: ids }, deletedAt: null }).lean().exec() as Lean[];
    if (docs.length !== ids.length) throw new NotFoundException('Часть заявок не найдена — обновите список');
    // Потерянный ответ создания: повтор полного того же набора возвращает существующие счета.
    if (docs.length && docs.every((d) => d.invoiceId)) {
      const invoiceIds = [...new Set(docs.map((d) => String(d.invoiceId)))];
      const requested = new Set(ids.map(String));
      const linked = await this.requests.find({ invoiceId: { $in: invoiceIds.map((id) => oid(id, 'счёта')) }, deletedAt: null, status: { $ne: 'cancelled' } }).lean().exec() as Lean[];
      if (linked.length === ids.length && linked.every((d) => requested.has(String(d._id)))) return { items: await Promise.all(invoiceIds.map((id) => this.get(id))) };
    }
    const names = await this.orgNames(docs.map((d) => d.supplierId));
    for (const d of docs) {
      const label = `Заявка №${d.num ?? '—'} «${d.title ?? ''}»`;
      if (d.invoiceId) throw new BadRequestException(`${label} уже входит в счёт`);
      if (!['requested', 'in_progress'].includes(String(d.status ?? 'requested'))) throw new BadRequestException(`${label}: заказать можно только заявку «Ожидает» или «Заказать»`);
      const lack = missing(ORDERED_GATE, d);
      if (lack.length) throw new BadRequestException(`${label}: не заполнено — ${lack.join(', ')}`);
    }
    const groups = new Map<string, Lean[]>();
    for (const d of docs) groups.set(String(d.supplierId), [...(groups.get(String(d.supplierId)) ?? []), d]);
    const createdBy = userId && Types.ObjectId.isValid(userId) ? new Types.ObjectId(userId) : undefined;
    const made = await this.tx(async (session) => {
      await this.claimRequests({ _id: { $in: docs.map(d => d._id) } }, session);
      const out: string[] = [];
      for (const [sup, list] of groups) {
        const [inv] = await this.model.create([{ supplierId: new Types.ObjectId(sup), supplierName: names.get(sup), status: 'draft', fileIds: [], createdBy }], { session });
        const res = await this.requests.updateMany(
          { _id: { $in: list.map((d) => d._id) }, deletedAt: null, invoiceId: { $exists: false }, paid: { $ne: true }, $or: list.map(d => ({ _id: d._id, qty: d.qty, status: d.status ?? null })) },
          { $set: { invoiceId: inv._id, status: 'ordered', paid: false, editedInApp: true } }, { session }).exec();
        if (res.modifiedCount !== list.length) throw new BadRequestException('Пока вы выбирали, кто-то изменил эти заявки. Обновите список и выберите заново');
        await this.recalcAmount({ _id: inv._id } as Lean, session);
        out.push(String(inv._id));
      }
      return out;
    });
    return { items: await Promise.all(made.map((i) => this.get(i))) };
  }

  /** Правка счёта. Финансовые поля разрешены до первой приёмки, даже после оплаты. */
  async update(id: string, dto: PatchInvoiceDto, actorId?: string, scope: StockScope | null = null) {
    const inv = await this.load(id);
    if (hasUndatedPayment(inv) && [...FINANCIAL_META, 'amount', 'payerCompanyId', 'supplierId', 'issue'].some(k => k in dto)) throw undatedLocked();
    if (inv.status === 'cancelled') throw new BadRequestException('Счёт отменён');
    if (inv.status === 'paid' && dto.issue) throw new BadRequestException('Оплаченный счёт нельзя повторно выставить');
    const newFinancial = FINANCIAL_META.some((k) => (dto as Lean)[k] !== undefined) || (!!inv.currency && dto.issue === true);
    if (inv.paymentAccountingVersion === 1 && Number(inv.paidAmount) > 0 && [...FINANCIAL_META, 'amount', 'payerCompanyId', 'supplierId'].some((k) => (dto as Lean)[k] !== undefined)) throw new ConflictException('После фактической оплаты финансовые реквизиты зафиксированы');
    const lock = await this.lockReason(inv);
    // «Нашу компанию» неоплаченного счёта можно указать и после приёмки: без неё счёт не оплатить (тупик, аудит 2026-11-06 №2)
    const meta = ['fileIds', 'contractId', 'no', 'date', 'deliveryDate', 'note', ...(inv.status !== 'paid' ? ['payerCompanyId'] : [])];
    const financial = Object.entries(dto).filter(([k, v]) => v !== undefined && !meta.includes(k));
    if (lock) {
      if (financial.length) throw new BadRequestException(`${lock}. Менять можно файлы, договор, номер, дату и нашу компанию (до оплаты)`);
      return this.patchLocked(inv, dto);
    }
    const set: Lean = this.deliveryFields(dto);
    for (const key of FINANCIAL_META) if ((dto as Lean)[key] !== undefined) set[key] = (dto as Lean)[key];
    const financeLines = newFinancial ? await this.linesOf(inv) : [];
    let valuation: ReturnType<typeof financials> | undefined;
    if (newFinancial) {
      const changedCurrency = dto.currency !== undefined && dto.currency !== (inv.currency || 'RUB');
      if (changedCurrency) {
        // Числа первички принадлежат валюте документа: старые RUB нельзя переименовать в UE/USD.
        set.financialLines = Object.fromEntries(Object.entries((inv.financialLines || {}) as FinancialRecord).map(([id, metadata]) => {
          const taxMode = { ...(metadata as FinancialRecord) };
          delete taxMode.sourceUnitPrice; delete taxMode.sourceLineAmount; delete taxMode.declaredVatAmount;
          return [id, taxMode];
        }));
        if (dto.declaredVatAmount === undefined) set.declaredVatAmount = null;
        for (const key of ['confirmedAmountRub', 'exchangeRate', 'exchangeRateDate', 'exchangeRateSource', 'conversionNote']) if ((dto as Lean)[key] === undefined) set[key] = null;
      }
      const nextFinancial = { ...inv, ...set };
      this.validateFinancialMeta(nextFinancial);
      valuation = financials(nextFinancial, financeLines);
      const stored = { ...((nextFinancial.financialLines || {}) as Lean) };
      for (const row of valuation.requests) if (row.sourceLineAmount !== null) stored[row.id] = { ...(stored[row.id] || {}), sourceLineAmount: row.sourceLineAmount };
      set.financialLines = stored;
      set.amount = valuation.accountingAmountRub ?? 0;
    }
    if (dto.no !== undefined) set.no = dto.no.trim() || undefined;
    if (dto.date !== undefined) {
      const d = parseSheetDate(dto.date);
      if (dto.date && !d) throw new BadRequestException('Дата счёта — в формате ДД.ММ.ГГГГ');
      set.date = d;
    }
    if (dto.fileIds !== undefined) set.fileIds = dto.fileIds.map((i) => oid(i, 'файла'));
    if (dto.payerCompanyId !== undefined) {
      if (dto.payerCompanyId) {
        const org = await this.connection.db!.collection('organizations').findOne({ _id: oid(dto.payerCompanyId, 'плательщика'), deletedAt: null });
        if (!org) throw new BadRequestException('Наша компания не найдена среди организаций');
        set.payerCompanyId = org._id;
      } else set.payerCompanyId = undefined;
    }
    if (dto.supplierId !== undefined) {
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
        // Ссылка из конфликта открывает только полностью видимый счёт.
        await this.assertWhole(String(dup._id), scope, true);
        // Автоматической склейки нет: дубль номера — конфликт, пользователь решает явно.
        if (dto.duplicateReason?.trim()) {
          // осознанно оставляем отдельный счёт с тем же номером — причина в карточке и в аудите
          set.duplicateOf = dup._id;
          set.duplicateReason = dto.duplicateReason.trim();
        } else {
          throw new ConflictException({
            message: `Счёт № ${String(dup.no)} у этого поставщика уже есть`,
            code: 'INVOICE_NUMBER_EXISTS',
            existingInvoiceId: String(dup._id),
            existingNo: dup.no ?? null,
            existingStatus: dup.status,
            hint: 'Откройте его, добавьте позиции явным объединением (POST /api/supply/invoices/<id>/merge) или сохраните с причиной (duplicateReason)',
          });
        }
      }
    }
    if (dto.amount !== undefined) {
      // amount — производная от строк; ввод общей суммы не «делит» цены заново (это и «слипало» строки)
      const sum = await this.linesSum(inv);
      if (Math.abs(Number(dto.amount) - sum) > 0.009) {
        throw new BadRequestException(`Сумма счёта считается по строкам (сейчас ${sum.toFixed(2)}). Измените цену позиции, а не общую сумму`);
      }
      set.amount = sum;
    }
    const next = { ...inv, ...set };
    if (dto.issue) {
      const sum = valuation ? valuation.accountingAmountRub ?? 0 : await this.linesSum(inv);
      if (!(Number(next.amount) > 0) && sum > 0) { set.amount = sum; next.amount = sum; }
      const lack = missing(ISSUED_GATE, valuation && valuation.currency !== 'RUB' && (valuation.sourceAmount || 0) > 0 ? { ...next, amount: valuation.sourceAmount } : next);
      if (lack.length) throw new BadRequestException(`Счёт нельзя отметить выставленным — не заполнено: ${lack.join(', ')}`);
      if (Math.abs((Number(next.amount) || 0) - sum) > 0.009) throw new BadRequestException('Сумма счёта не совпадает с суммой строк — исправьте цены позиций');
      set.status = 'issued';
      next.status = 'issued';
    }
    const status = (set.status ?? inv.status) as string;
    await this.tx(async (session) => {
      await this.claimRequests({ invoiceId: inv._id }, session);
      const duplicate = await this.recheckIntakeIdentity(inv, set, dto.duplicateReason, session);
      // Дополнительные поля применяются только в успешно зафиксированной транзакции.
      const applied = { ...set, ...duplicate };
      if (financial.length) await this.touchFinancialInvoice(inv._id, session, inv.version);
      else if (dto.payerCompanyId !== undefined) {
        const guarded = await this.model.updateOne({ _id: inv._id, version: inv.version, 'undatedPaymentEvidence.state': { $ne: 'pending' } }, { $inc: { version: 1 } }, { session }).exec();
        if (!guarded.matchedCount) throw undatedLocked();
      }
      if (valuation) for (const row of valuation.requests) await this.requests.updateOne({ _id: row._id, invoiceId: inv._id }, { $set: { priceHint: row.accountingLineAmountRub ?? 0, editedInApp: true } }, { session }).exec();
      const $set: Lean = {}; const $unset: Lean = {};
      for (const [k, v] of Object.entries(applied)) (v === undefined ? $unset : $set)[k] = v === undefined ? '' : v;
      await this.model.updateOne({ _id: inv._id }, { ...(Object.keys($set).length ? { $set } : {}), ...(Object.keys($unset).length ? { $unset } : {}), $inc: { version: 1 } }, { session }).exec();
      // № / дата / плательщик — метаданные строк, и у черновика тоже: доска заявок подписывает счёт по invoiceNo заявки
      // (2026-11-09: черновик с номером показывался «Счёт без номера»); цены не перераспределяются (это и «слипало» строки)
      const metaChanged = ['no', 'date', 'payerCompanyId'].some((k) => k in set);
      if (status === 'issued' || status === 'paid' || metaChanged) await this.copyMetaToRequests({ ...next, status }, session);
      if (status === 'issued' || status === 'paid') {
        // invoice_paid — факт первоначальной оплаты. После оплаты цены меняет только отдельная корректировка.
        if (status === 'issued') await this.recordPrices({ ...next, status }, 'invoice_issued', session);
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

  /** Добавить заявки до первой приёмки (в том числе в paid); сумма и история цен пересчитываются в транзакции. */
  async addRequests(id: string, requestIds: string[], reason?: string, actorId?: string) {
    const inv = await this.load(id);
    if (hasUndatedPayment(inv)) throw undatedLocked();
    if (inv.status === 'cancelled') throw new BadRequestException('Счёт отменён');
    if (inv.paymentAccountingVersion === 1 && Number(inv.paidAmount) > 0) throw new ConflictException('Фактические платежи зафиксировали финансовую базу: добавление строк требует сверки');
    const lock = await this.lockReason(inv);
    if (lock) throw new BadRequestException(`${lock}. Добавить позиции можно только до первой приёмки`);
    const ids = [...new Set(requestIds)].map((i) => oid(i, 'заявки'));
    const docs = await this.requests.find({ _id: { $in: ids }, deletedAt: null }).lean().exec() as Lean[];
    if (docs.length !== ids.length) throw new NotFoundException('Часть заявок не найдена — обновите список');
    for (const d of docs) {
      const label = `Заявка №${d.num ?? '—'} «${d.title ?? ''}»`;
      if (d.invoiceId) throw new BadRequestException(`${label} уже входит в счёт`);
      const st = String(d.status ?? 'requested');
      const canAdd = st === 'requested' || st === 'in_progress' || st === 'ordered';
      if (!canAdd) throw new BadRequestException(`${label}: добавить можно заявку «Ожидает», «Заказать» или «В работе»`);
      // своя оплата заявки + оплата счёта = двойной расход в «Деньгах»
      if (d.paid === true) throw new BadRequestException(`${label} уже оплачена отдельно — сначала снимите оплату (статус «В работе»)`);
      if (inv.supplierId && d.supplierId && String(d.supplierId) !== String(inv.supplierId)) throw new BadRequestException(`${label}: другой поставщик, чем у счёта`);
      if (st === 'requested' || st === 'in_progress') {
        const lack = missing(ORDERED_GATE, { ...d, supplierId: d.supplierId ?? inv.supplierId });
        if (lack.length) throw new BadRequestException(`${label}: не заполнено — ${lack.join(', ')}`);
      }
    }
    const addedPaidAt = inv.status === 'paid' ? (inv.paidAt as Date | undefined) ?? new Date() : undefined;
    const amount = await this.tx(async (session) => {
      await this.claimRequests({ $or: [{ invoiceId: inv._id }, { _id: { $in: ids } }] }, session);
      await this.touchFinancialInvoice(inv._id, session, inv.version);
      const attached = await this.requests.updateMany({ _id: { $in: ids }, deletedAt: null, invoiceId: null, paid: { $ne: true }, $or: docs.map(d => ({ _id: d._id, qty: d.qty, status: d.status ?? null })) },
        { $set: { invoiceId: inv._id, status: 'ordered', editedInApp: true,
          ...(inv.supplierId ? { supplierId: inv.supplierId } : {}),
          ...(inv.status === 'paid' ? { paid: true, paidAt: addedPaidAt } : {}) } }, { session }).exec();
      if (attached.matchedCount !== ids.length) throw new ConflictException('Количество, статус или привязка заявок изменились — обновите список');
      const fresh = { ...inv } as Lean;
      const sum = await this.recalcAmount(fresh, session);
      await this.copyMetaToRequests({ ...inv, amount: sum }, session); // № и дата счёта — в новые строки и у черновика
      if (inv.status === 'issued' || inv.status === 'paid') {
        await this.recordPrices({ ...inv, amount: sum, ...(inv.status === 'paid' ? { date: new Date() } : {}) }, inv.status === 'paid' ? 'invoice_adjustment' : 'invoice_issued', session, ids);
      }
      if (inv.status === 'paid') await this.recordPaymentAdjustment(inv, session, { reason, actorId, operation: 'lines_added', beforeAmount: Number(inv.amount) || 0, afterAmount: sum, requestIds: docs.map((d) => d._id as Types.ObjectId) });
      return sum;
    });
    return { ...(await this.get(id)), amount };
  }

  /** Предпросмотр явного объединения: ничего не меняет, показывает строки, дубли и итоговые суммы. */
  async mergePreview(id: string, targetId: string, actor?: OverrideActor) {
    const [src, dst] = await Promise.all([this.load(id), this.load(targetId)]);
    await this.assertMergeable(src, dst, actor);
    const [a, b] = await Promise.all([this.linesOf(src), this.linesOf(dst)]);
    const sum = (ls: Lean[]) => Math.round(ls.reduce((t, l) => t + (Number(l.priceHint) || 0), 0) * 100) / 100;
    const dup = a.filter((l) => b.some((d) => this.sameLine(d, l)));
    const dupSum = Math.round(dup.reduce((t, l) => t + (Number(l.priceHint) || 0), 0) * 100) / 100;
    return {
      source: { id: String(src._id), no: src.no ?? null, date: src.date ?? null, status: src.status, lines: a.length, amount: sum(a) },
      target: { id: String(dst._id), no: dst.no ?? null, date: dst.date ?? null, status: dst.status, lines: b.length, amount: sum(b) },
      duplicates: dup.length,
      strategies: dup.length && !isAdminActor(actor) ? ['append', 'replaceLines'] : ['append', 'mergeSameRequest', 'replaceLines'],
      resultAmount: {
        append: Math.round((sum(a) + sum(b)) * 100) / 100,
        mergeSameRequest: Math.round((sum(a) - dupSum + sum(b)) * 100) / 100,
        replaceLines: sum(a),
      },
    };
  }

  /** Явное объединение двух счетов. Стратегия выбирается пользователем; пишется в журнал счёта и в аудит. */
  async merge(id: string, targetId: string, strategy: 'append' | 'mergeSameRequest' | 'replaceLines', actor?: OverrideActor) {
    if (!['append', 'mergeSameRequest', 'replaceLines'].includes(strategy)) throw new BadRequestException('Стратегия объединения: append, mergeSameRequest или replaceLines');
    const [src, dst] = await Promise.all([this.load(id), this.load(targetId)]);
    await this.assertMergeable(src, dst, actor);
    const by = actor?.id && Types.ObjectId.isValid(actor.id) ? new Types.ObjectId(actor.id) : undefined;
    const out = await this.tx(async (session) => {
      await this.claimRequests({ invoiceId: { $in: [src._id, dst._id] } }, session);
      await this.touchFinancialInvoice(src._id, session, src.version);
      await this.touchFinancialInvoice(dst._id, session, dst.version);
      const a = await this.linesOf(src, session);
      const b = strategy === 'mergeSameRequest' || strategy === 'replaceLines' ? await this.linesOf(dst, session) : [];
      const duplicates = new Set(strategy === 'mergeSameRequest' ? a.filter((line) => b.some((other) => this.sameLine(other, line))) : []);
      if (duplicates.size) assertAdminActor(actor, 'Удаление дублей заявок');
      let moved = 0, skipped = 0, replaced = 0;
      const files = new Map<string, Types.ObjectId>();
      for (const f of [...((dst.fileIds as Types.ObjectId[]) ?? []), ...((src.fileIds as Types.ObjectId[]) ?? [])]) files.set(String(f), f);
      const patch: Lean = { fileIds: [...files.values()] };
      for (const k of ['contractId', 'payerCompanyId', 'date', 'no']) if (!dst[k] && src[k]) patch[k] = src[k];
      const target = { ...dst, ...patch };
      if (strategy === 'replaceLines') {
        for (const d of b) {
          await this.requests.updateOne({ _id: d._id },
            { $unset: { invoiceId: '', invoiceNo: '', invoiceDate: '' }, $set: { ...(d.status === 'ordered' && d.paid !== true ? { status: 'requested' } : {}), editedInApp: true } }, { session }).exec();
          replaced++;
        }
      }
      for (const l of a) {
        if (duplicates.has(l)) {
          await this.requests.updateOne({ _id: l._id }, { $set: { deletedAt: new Date(), status: 'cancelled', editedInApp: true } }, { session }).exec();
          skipped++;
          continue;
        }
        await this.requests.updateOne({ _id: l._id }, { $set: { invoiceId: dst._id,
          invoiceNo: target.no ?? null, invoiceDate: target.date ?? null, companyId: target.payerCompanyId ?? null,
          ...(dst.supplierId ? { supplierId: dst.supplierId } : {}), editedInApp: true } }, { session }).exec();
        moved++;
      }
      await this.model.updateOne({ _id: dst._id },
        { $set: patch, $push: { mergeLog: { at: new Date(), ...(by ? { by } : {}), fromId: src._id, strategy, moved, skipped, replaced } } }, { session }).exec();
      const amount = await this.recalcAmount({ ...dst, ...patch }, session);
      await this.model.updateOne({ _id: src._id }, { $set: { deletedAt: new Date(), mergedInto: dst._id, status: 'cancelled' } }, { session }).exec();
      return { moved, skipped, replaced, amount };
    });
    return { targetInvoiceId: String(dst._id), ...out, invoice: await this.get(String(dst._id)) };
  }

  private async assertMergeable(src: Lean, dst: Lean, actor?: OverrideActor) {
    const showMoney = canSeeMoney(actor);
    const unavailable = 'Эти счета нельзя объединить. Откройте существующий счёт или обратитесь к администратору.';
    if (hasUndatedPayment(src) || hasUndatedPayment(dst)) throw showMoney ? undatedLocked() : new ConflictException(unavailable);
    if ([src, dst].some((i) => i.paymentAccountingVersion === 1 && Number(i.paidAmount) > 0)) throw new ConflictException(showMoney ? 'Нельзя объединить счёт с фактическими платежами' : unavailable);
    if ([src, dst].some((i) => i.currency && i.currency !== 'RUB')) throw new ConflictException(showMoney ? 'Валютные счета объединяются только после отдельной сверки' : unavailable);
    if (String(src._id) === String(dst._id)) throw new BadRequestException('Нельзя объединить счёт с самим собой');
    if (src.status === 'cancelled' || dst.status === 'cancelled') throw new BadRequestException('Отменённый счёт не объединяется');
    if (src.supplierId && dst.supplierId && String(src.supplierId) !== String(dst.supplierId)) throw new BadRequestException('Счета разных поставщиков не объединяются');
    const lockSrc = await this.lockReason(src);
    if (lockSrc) throw new BadRequestException(`${lockSrc} — этот счёт нельзя объединить`);
    const lockDst = await this.lockReason(dst);
    if (lockDst) throw new BadRequestException(`${lockDst} — в этот счёт нельзя объединить`);
    if (src.status === 'paid' || dst.status === 'paid') throw new BadRequestException(showMoney ? 'Оплаченные счета нельзя объединять — до приёмки можно отдельно добавить или исправить позиции' : unavailable);
  }

  /** Одна и та же позиция: материал (или наименование) + количество + сумма строки. */
  private sameLine(a: Lean, b: Lean): boolean {
    const t = (x: Lean) => String(x.title ?? x.materialName ?? '');
    if (a.materialId && b.materialId) return String(a.materialId) === String(b.materialId) && Number(a.qty) === Number(b.qty) && Number(a.priceHint) === Number(b.priceHint);
    return t(a) === t(b) && Number(a.qty) === Number(b.qty) && Number(a.priceHint) === Number(b.priceHint);
  }

  /** После приёмки счёта можно менять только метаданные (файлы, договор, №, дата). */
  private deliveryFields(dto: PatchInvoiceDto): Lean {
    const fields: Lean = {};
    if (typeof dto.note === 'string') fields.note = dto.note.trim() || undefined;
    if (typeof dto.deliveryDate === 'string') {
      const d = parseSheetDate(dto.deliveryDate);
      if (dto.deliveryDate && !d) throw new BadRequestException('Укажите дату доставки');
      fields.deliveryDate = d ?? undefined;
    }
    return fields;
  }

  private async patchLocked(inv: Lean, dto: PatchInvoiceDto) {
    const $set: Lean = {}; const $unset: Lean = {};
    for (const [k, v] of Object.entries(this.deliveryFields(dto))) {
      if (v === undefined) $unset[k] = '';
      else $set[k] = v;
    }
    if (dto.fileIds !== undefined) $set.fileIds = dto.fileIds.map((i) => oid(i, 'файла'));
    if (dto.contractId) $set.contractId = await this.checkContract(dto.contractId, inv.supplierId, inv.contractId);
    else if (dto.contractId === '') $unset.contractId = '';
    if (dto.no !== undefined) { if (dto.no.trim()) $set.no = dto.no.trim(); else $unset.no = ''; }
    if (dto.date) {
      const d = parseSheetDate(dto.date);
      if (!d) throw new BadRequestException('Дата счёта — в формате ДД.ММ.ГГГГ');
      $set.date = d;
    }
    if (dto.payerCompanyId && inv.status !== 'paid') {
      const org = await this.connection.db!.collection('organizations').findOne({ _id: oid(dto.payerCompanyId, 'компании'), deletedAt: null });
      if (!org) throw new BadRequestException('Наша компания не найдена среди организаций');
      $set.payerCompanyId = org._id;
    }
    if (Object.keys($set).length || Object.keys($unset).length) {
      await this.tx(async (session) => {
      await this.claimRequests({ invoiceId: inv._id }, session);
        const changes = { ...$set, ...Object.fromEntries(Object.keys($unset).map(key => [key, undefined])) };
        const duplicate = await this.recheckIntakeIdentity(inv, changes, dto.duplicateReason, session);
        const applied = { ...$set, ...duplicate };
        const guarded = await this.model.updateOne({ _id: inv._id, ...(dto.payerCompanyId !== undefined ? { 'undatedPaymentEvidence.state': { $ne: 'pending' }, version: inv.version } : {}) }, { ...(Object.keys(applied).length ? { $set: applied } : {}), ...(Object.keys($unset).length ? { $unset } : {}), $inc: { version: 1 } }, { session }).exec();
        if (!guarded.matchedCount) throw undatedLocked();
        // № / дата / плательщик — метаданные строк, цены и количество не трогаем
        if (['no', 'date', 'payerCompanyId'].some((k) => k in $set || k in $unset)) await this.copyMetaToRequests({ ...inv, ...$set }, session);
      });
    }
    return this.get(String(inv._id));
  }

  /** Копия только метаданных счёта (№, дата, плательщик, поставщик) в заявки — без пересчёта суммы по строкам. */
  private async copyMetaToRequests(inv: Lean, session: ClientSession) {
    const lines = await this.requests.find({ invoiceId: inv._id, deletedAt: null }).sort({ num: 1, _id: 1 }).session(session).lean().exec() as Lean[];
    const common = { invoiceNo: inv.no, invoiceDate: inv.date, editedInApp: true, ...(inv.supplierId ? { supplierId: inv.supplierId } : {}), ...(inv.payerCompanyId ? { companyId: inv.payerCompanyId } : {}) };
    for (const l of lines) {
      // цены строк — собственность строки: здесь не пишем priceHint
      await this.requests.updateOne({ _id: l._id }, { $set: { ...common } }, { session }).exec();
    }
  }

  /** Строка истории цен на каждую заявку счёта с materialId: сумма строки (после деления) / количество. */
  private async recordPrices(inv: Lean, source: PriceSource, session: ClientSession, only?: Types.ObjectId[]) {
    if (inv.currency && inv.currency !== 'RUB' && inv.confirmedAmountRub == null && !(Number(inv.exchangeRate) > 0)) return; // неизвестный пересчёт не записывается как рублёвая цена0
    const lines = await this.requests.find({ invoiceId: inv._id, deletedAt: null, status: { $ne: 'cancelled' }, materialId: { $exists: true, $ne: null }, ...(only ? { _id: { $in: only } } : {}) }).session(session).lean().exec() as Lean[];
    for (const l of lines) {
      await this.prices.record({
        materialId: l.materialId as Types.ObjectId, supplierId: inv.supplierId as Types.ObjectId | undefined, supplierName: inv.supplierName as string | undefined,
        lineTotalWithVat: Number(l.priceHint) || 0, qty: Number(l.qty) || 0, unit: l.unit as string | undefined, vatRate: inv.vatRate as number | undefined,
        date: (inv.date as Date | undefined) ?? new Date(), source, invoiceId: inv._id as Types.ObjectId, requestId: l._id as Types.ObjectId,
        salesOrderId: l.salesOrderId as Types.ObjectId | undefined, createdBy: inv.createdBy as Types.ObjectId | undefined,
      }, session);
    }
  }

  /**
   * Правка цены/количества одной строки; amount и цена материала пересчитываются в транзакции.
   * До приёмки — менеджер и админ. После приёмки (решение пользователя 2026-11-06) — только администратор:
   * цену и сумму можно на любой стадии; количество принятой строки — нет (оно уже на складе, меняется отменой приёмки).
   * `audited` — вызывающий сам пишет журнал обхода (adminEditLine).
   */
  async updateLine(invoiceId: string, lineId: string, dto: PatchInvoiceLineDto, actorId?: string, actor?: OverrideActor, audited = false) {
    const document = await this.load(invoiceId);
    if (hasUndatedPayment(document)) throw undatedLocked();
    if (document.paymentAccountingVersion === 1 && Number(document.paidAmount) > 0) {
      if (isAdminActor(actor) && dto.reason?.trim()) return this.updatePaidRubLine(document, lineId, dto, actorId, actor, audited);
      throw new ConflictException('Фактические платежи зафиксировали финансовую базу: требуется отдельная сверка корректировки');
    }
    if (document.currency || document.vatMode || SOURCE_LINE_KEYS.some((k) => (dto as Lean)[k] !== undefined)) return this.updateFinancialLine(document, lineId, dto);
    const inv = await this.load(invoiceId);
    if (inv.status === 'cancelled') throw new BadRequestException('Счёт отменён');
    const lock = await this.lockReason(inv);
    const adminAfterReceipt = !!lock && isAdminActor(actor);
    if (lock && !adminAfterReceipt) throw new BadRequestException(`${lock}. Цену после приёмки исправляет администратор`);
    const line = await this.requests.findOne({ _id: oid(lineId, 'заявки'), invoiceId: inv._id, deletedAt: null }).exec() as Lean | null;
    if (!line) throw new NotFoundException('Строка не найдена в счёте');
    if (line.status === 'cancelled') throw new BadRequestException('Строка отменена — её цену не правят');
    const oldQty = Number(line.qty) || 0;
    const qty = dto.qty !== undefined ? Number(dto.qty) : oldQty;
    if (!Number.isFinite(qty) || !(qty > 0)) throw new BadRequestException('Количество строки должно быть больше нуля');
    if (line.status === 'received' && qty !== oldQty) throw new BadRequestException('Позиция уже принята на склад — количество меняется только отменой приёмки. Цену и сумму исправить можно');
    let priceHint: number;
    if (dto.lineAmount !== undefined) {
      if (!(Number(dto.lineAmount) >= 0)) throw new BadRequestException('Сумма строки не может быть отрицательной');
      priceHint = Math.round(Number(dto.lineAmount) * 100) / 100;
    } else if (dto.unitPrice !== undefined) {
      if (!(Number(dto.unitPrice) >= 0)) throw new BadRequestException('Цена за единицу не может быть отрицательной');
      priceHint = Math.round(Number(dto.unitPrice) * qty * 100) / 100;
    } else if (dto.qty !== undefined) {
      if (!(oldQty > 0)) throw new BadRequestException('Укажите цену за единицу (unitPrice) или сумму строки (lineAmount) вместе с количеством');
      priceHint = Math.round(((Number(line.priceHint) || 0) / oldQty) * qty * 100) / 100;
    } else throw new BadRequestException('Укажите цену за единицу (unitPrice) или сумму строки (lineAmount)');
    const amount = await this.tx(async (session) => {
      await this.claimRequests({ invoiceId: inv._id }, session);
      if (dto.version !== undefined) {
        const fresh = await this.model.findOne({ _id: inv._id }, { version: 1 }).session(session).lean().exec() as Lean | null;
        if (Number(fresh?.version ?? 0) !== Number(dto.version)) throw new ConflictException('Счёт изменился, пока вы правили цену — обновите и повторите');
      }
      // после приёмки граница уже стоит: версию поднимаем без условия «приёмки нет»
      if (adminAfterReceipt) {
        const guarded = await this.model.updateOne({ _id: inv._id, version: inv.version, 'undatedPaymentEvidence.state': { $ne: 'pending' } }, { $inc: { version: 1 } }, { session }).exec();
        if (!guarded.matchedCount) throw undatedLocked();
      }
      else await this.touchFinancialInvoice(inv._id, session, inv.version);
      await this.requests.updateOne({ _id: line._id }, { $set: { priceHint, ...(dto.qty !== undefined ? { qty } : {}), editedInApp: true } }, { session }).exec();
      // Снимок invoice_paid не перезаписываем: исправление — отдельная строка истории цены.
      const source: PriceSource = inv.status === 'draft' ? 'manual' : inv.status === 'paid' ? 'invoice_adjustment' : 'invoice_issued';
      await this.recordPrices({ ...inv, amount: priceHint, ...(inv.status === 'paid' ? { date: new Date() } : {}) }, source, session, [line._id as Types.ObjectId]);
      const amount = await this.recalcAmount(inv, session);
      if (inv.status === 'paid') await this.recordPaymentAdjustment(inv, session, { reason: dto.reason, actorId, operation: 'line_edit', beforeAmount: Number(inv.amount) || 0, afterAmount: amount, requestIds: [line._id as Types.ObjectId] });
      return amount;
    });
    if (adminAfterReceipt && !audited) {
      await adminOverride(this.audit, {
        rule: 'supply.price_after_receipt', entityType: 'SupplyRequest', entityId: line._id,
        before: { priceHint: line.priceHint ?? null, qty: oldQty, invoiceAmount: inv.amount ?? null },
        after: { priceHint, qty, invoiceAmount: amount },
        reason: dto.reason?.trim() || 'Исправление цены администратором после приёмки', actor,
      });
    }
    const invoice = await this.get(invoiceId);
    return { invoice, line: { id: String(lineId), qty, unitPrice: Math.round((priceHint / qty) * 100) / 100, lineAmount: priceHint }, amount };
  }

  /**
   * ЗЯ-1 п.3: администратор меняет сумму/количество строки через PATCH заявки — уходит в правку строки счёта
   * (пересчёт amount, история цены; у оплаченного — запись в paymentAdjustments) с причиной и записью в журнал.
   * Заявка без счёта → false (правка идёт обычным путём).
   * Менеджер (решение Б, 2026-11-06): та же правка строки до приёмки, без причины и журнала обхода — как в самом счёте.
   */
  async adminEditLine(requestId: string, dto: { priceHint?: number | null; qty?: number; reason?: string }, actor: OverrideActor): Promise<boolean> {
    const line = await this.requests.findOne({ _id: oid(requestId, 'заявки'), deletedAt: null }).lean().exec() as Lean | null;
    if (!line?.invoiceId) return false;
    if (dto.priceHint === null) throw new BadRequestException('Сумму позиции счёта нельзя стереть — впишите сумму');
    if (!isAdminActor(actor)) {
      await this.updateLine(String(line.invoiceId), requestId, {
        ...(dto.priceHint !== undefined ? { lineAmount: dto.priceHint } : {}), ...(dto.qty !== undefined ? { qty: dto.qty } : {}),
      }, actor.id, actor);
      return true;
    }
    const reason = overrideReason(dto.reason);
    const inv = await this.load(String(line.invoiceId));
    const before = { priceHint: line.priceHint ?? null, qty: line.qty ?? null, invoiceAmount: inv.amount ?? null };
    const res = await this.updateLine(String(line.invoiceId), requestId, {
      ...(dto.priceHint !== undefined && dto.priceHint !== null ? { lineAmount: dto.priceHint } : {}), ...(dto.qty !== undefined ? { qty: dto.qty } : {}), reason,
    }, actor.id, actor, true);
    await adminOverride(this.audit, {
      rule: 'supply.invoiced_line', entityType: 'SupplyRequest', entityId: requestId,
      before,
      after: { priceHint: res.line.lineAmount, qty: res.line.qty, invoiceAmount: res.amount }, reason, actor,
    });
    return true;
  }

  /** Убрать строку из счёта, не удаляя заявку: до первой приёмки (в т. ч. оплаченный); вернуть в «Заказать», пересчитать сумму. */
  async removeLine(invoiceId: string, lineId: string, actorId?: string, actor?: OverrideActor) {
    const inv = await this.load(invoiceId);
    if (hasUndatedPayment(inv)) throw undatedLocked();
    if (inv.status === 'cancelled') throw new BadRequestException('Счёт отменён');
    // менеджер убирает позицию из неоплаченного счёта (иначе не отменить заявку); оплаченный — только администратор
    if (actor && !isAdminActor(actor) && inv.status === 'paid') throw new ForbiddenException('Счёт оплачен — убрать позицию может только администратор');
    const lock = await this.lockReason(inv);
    if (lock) throw new BadRequestException(`${lock}. Убрать строку можно только до первой приёмки`);
    const line = await this.requests.findOne({ _id: oid(lineId, 'заявки'), invoiceId: inv._id, deletedAt: null }).exec() as Lean | null;
    if (!line) throw new NotFoundException('Строка не найдена в счёте');
    if (line.status === 'received') throw new BadRequestException('Строка уже принята на склад');
    const beforeAmount = Number(inv.amount) || 0;
    const amount = await this.tx(async (session) => {
      await this.claimRequests({ _id: line._id }, session);
      await this.touchFinancialInvoice(inv._id, session, inv.version);
      await this.requests.updateOne({ _id: line._id },
        // оплата строки — это оплата счёта: вне счёта строка не оплачена (иначе двойной расход в «Деньгах»)
        { $unset: { invoiceId: '', invoiceNo: '', invoiceDate: '', paidAt: '' }, $set: { ...(line.status === 'ordered' ? { status: 'requested' } : {}), paid: false, editedInApp: true } }, { session }).exec();
      const afterAmount = await this.recalcAmount(inv, session);
      if (inv.status === 'paid') {
        await this.recordPaymentAdjustment(inv, session, {
          reason: 'Позиция убрана из счёта до приёмки',
          actorId, operation: 'line_removed', beforeAmount, afterAmount, requestIds: [line._id as Types.ObjectId],
        });
      }
      return afterAmount;
    });
    return { invoice: await this.get(invoiceId), removed: String(line._id), amount };
  }

  /** Явный админский обход RUB: факты и allocations неизменны, обязательство и история пересчитываются. */
  private async updatePaidRubLine(inv: Lean, lineId: string, dto: PatchInvoiceLineDto, actorId?: string, actor?: OverrideActor, audited = false) {
    const reason = overrideReason(dto.reason);
    if ((inv.currency || 'RUB') !== 'RUB') throw new ConflictException('Валютная корректировка оплаченного счёта требует отдельной сверки');
    if (SOURCE_LINE_KEYS.some((key) => (dto as Lean)[key] !== undefined)) throw new ConflictException('В этом обходе изменяется только рублёвая цена или количество');
    const lines = await this.linesOf(inv), line = lines.find((x) => String(x._id) === lineId);
    if (!line) throw new NotFoundException('Строка не найдена');
    const qty = dto.qty ?? Number(line.qty), oldQty = Number(line.qty);
    if (!(qty > 0) || !Number.isFinite(qty)) throw new BadRequestException('Количество должно быть больше нуля');
    if (line.status === 'received' && qty !== oldQty) throw new ConflictException('Количество принятой позиции меняется отменой приёмки');
    const gross = dto.lineAmount ?? Math.round((dto.unitPrice ?? Number(line.priceHint) / oldQty) * qty * 100) / 100;
    if (!(gross >= 0) || !Number.isFinite(gross)) throw new BadRequestException('Сумма строки не может быть отрицательной');
    const stored = { ...((inv.financialLines || {}) as FinancialRecord) }, meta = { ...(stored[lineId] || {}) };
    const mode = meta.vatMode ?? inv.vatMode, rate = Number(meta.vatRate ?? inv.vatRate);
    meta.sourceLineAmount = mode === 'excluded' ? Math.round(gross / (1 + rate / 100) * 100) / 100 : gross;
    delete meta.sourceUnitPrice;
    stored[lineId] = meta;
    const valuation = financials({ ...inv, financialLines: stored }, lines.map((x) => x === line ? { ...x, qty } : x));
    const adjusted = valuation.requests.find((x) => x.id === lineId)!;
    if (adjusted.accountingLineAmountRub !== gross) throw new ConflictException('Рублёвая сумма не согласуется с НДС строки; требуется отдельная сверка');
    await this.tx(async (session) => {
      await this.claimRequests({ invoiceId: inv._id }, session);
      const touched = await this.model.updateOne({ _id: inv._id, version: inv.version, deletedAt: null, 'undatedPaymentEvidence.state': { $ne: 'pending' } }, { $inc: { version: 1 }, $set: { amount: valuation.accountingAmountRub, financialLines: stored } }, { session }).exec();
      if (!touched.matchedCount) throw new ConflictException('Счёт изменился — обновите карточку');
      await this.requests.updateOne({ _id: line._id, invoiceId: inv._id }, { $set: { qty, priceHint: gross, editedInApp: true } }, { session }).exec();
      await this.recordPrices(inv, 'invoice_adjustment', session, [line._id as Types.ObjectId]);
      await this.recordPaymentAdjustment(inv, session, { operation: 'line_edit', reason, actorId, beforeAmount: Number(inv.amount), afterAmount: valuation.accountingAmountRub!, requestIds: [line._id as Types.ObjectId] });
      await this.ledger!.refreshAfterAdjustment(String(inv._id), session);
    });
    if (!audited) await adminOverride(this.audit, { rule: 'supply.invoiced_line', entityType: 'SupplyRequest', entityId: lineId, before: { priceHint: line.priceHint ?? null, qty: line.qty, invoiceAmount: inv.amount }, after: { priceHint: gross, qty, invoiceAmount: valuation.accountingAmountRub }, reason, actor: actor || { id: actorId } });
    return { invoice: await this.get(String(inv._id)), line: { id: lineId, qty, lineAmount: gross, unitPrice: Math.round(gross / qty * 100) / 100 }, amount: valuation.accountingAmountRub! };
  }

  private validateFinancialMeta(inv: Lean) {
    if (inv.currency === 'UE' && !String(inv.currencyName || '').trim()) throw new BadRequestException('Укажите наименование условной единицы из договора');
    if (inv.exchangeRate != null) {
      if (!(Number(inv.exchangeRate) > 0) || !inv.exchangeRateDate || !String(inv.exchangeRateSource || '').trim()) throw new BadRequestException('Для курса укажите дату и основание');
      factDate(String(inv.exchangeRateDate));
    }
    if (inv.confirmedAmountRub != null && !String(inv.conversionNote || '').trim() && !(inv.fileIds as unknown[] | undefined)?.length) throw new BadRequestException('Подтверждённой рублёвой сумме нужно основание: примечание или файл');
  }

  private async updateFinancialLine(inv: Lean, lineId: string, dto: PatchInvoiceLineDto) {
    const lock = await this.lockReason(inv);
    if (lock) throw new ConflictException(lock);
    const lines = await this.linesOf(inv), line = lines.find((x) => String(x._id) === lineId);
    if (!line) throw new NotFoundException('Строка не найдена в счёте');
    const qty = dto.qty ?? Number(line.qty);
    const stored = { ...((inv.financialLines || {}) as FinancialRecord) }, meta = { ...(stored[lineId] || {}) };
    for (const key of SOURCE_LINE_KEYS) if ((dto as Lean)[key] !== undefined) meta[key] = (dto as Lean)[key];
    if ((inv.currency || 'RUB') === 'RUB' && dto.lineAmount !== undefined) meta.sourceLineAmount = dto.lineAmount;
    else if ((inv.currency || 'RUB') === 'RUB' && dto.unitPrice !== undefined) meta.sourceLineAmount = Math.round(dto.unitPrice * qty * 100) / 100;
    if (dto.sourceLineAmount === undefined && dto.sourceUnitPrice !== undefined) meta.sourceLineAmount = Math.round(dto.sourceUnitPrice * qty * 100) / 100;
    stored[lineId] = meta;
    const nextLines = lines.map((x) => x === line ? { ...x, qty } : x), valuation = financials({ ...inv, financialLines: stored }, nextLines);
    await this.tx(async (session) => {
      await this.claimRequests({ invoiceId: inv._id }, session);
      const fresh = await this.load(String(inv._id));
      if (Number(fresh.version || 0) !== Number(dto.version ?? inv.version ?? 0)) throw new ConflictException('Счёт изменился — обновите карточку');
      await this.touchFinancialInvoice(inv._id, session, inv.version);
      for (const row of valuation.requests) await this.requests.updateOne({ _id: row._id, invoiceId: inv._id }, { $set: { priceHint: row.accountingLineAmountRub ?? 0, ...(row.id === lineId ? { qty } : {}), editedInApp: true } }, { session }).exec();
      await this.model.updateOne({ _id: inv._id }, { $set: { financialLines: stored, amount: valuation.accountingAmountRub ?? 0 }, $inc: { version: 1 } }, { session }).exec();
    });
    const invoice = await this.get(String(inv._id));
    const output = (invoice.requests as Lean[]).find((x) => String(x.id || x._id) === lineId)!;
    return { invoice, line: output, amount: invoice.amount };
  }
  async confirmUndatedPayment(id: string, dto: UndatedInvoicePaymentDto, actorId?: string) { await this.undated!.confirm(id, dto, actorId); return this.get(id); }
  async revokeUndatedPayment(id: string, dto: RevokeUndatedInvoicePaymentDto, actorId?: string) { await this.undated!.revoke(id, dto, actorId); return this.get(id); }

  async addPayment(id: string, dto: CreateInvoicePaymentDto, actorId?: string) {
    if (!this.ledger) throw new BadRequestException('Учёт платежей не подключён');
    await this.ledger.add(id, dto, actorId, (invoice, session) => this.recordPrices(invoice, 'invoice_paid', session));
    return this.get(id);
  }
  async listPayments(id: string, q: Record<string, string | undefined>, scope: StockScope | null = null) {
    if (!this.ledger) throw new BadRequestException('Учёт платежей не подключён');
    const inv = await this.load(id), lines = await this.linesOf(inv);
    const visible = await this.visibleRequests(lines.map((x) => x._id as Types.ObjectId), scope);
    if (visible && !visible.size) throw new ForbiddenException('Этот счёт не из вашего склада');
    return this.ledger.list(id, q, visible || undefined);
  }
  async voidPayment(id: string, paymentId: string, dto: VoidInvoicePaymentDto, actor: OverrideActor, dryRun: boolean) {
    if (!this.ledger) throw new BadRequestException('Учёт платежей не подключён');
    const result = await this.ledger.void(id, paymentId, dto, actor, dryRun);
    return dryRun ? result : this.get(id);
  }

  /** Оплата всего счёта: нужен «выставлен», плательщик и amount = сумма строк. */
  async pay(id: string, actorId?: string) {
    if (this.ledger) { await this.ledger.payRemaining(id, actorId, (invoice, session) => this.recordPrices(invoice, 'invoice_paid', session)); return this.get(id); }
    const inv = await this.load(id);
    if (inv.status === 'paid') return this.get(id);
    if (inv.status !== 'issued') throw new BadRequestException('Сначала отметьте счёт выставленным: нужны №, дата, сумма и наша компания');
    if (!inv.payerCompanyId) throw new BadRequestException('Укажите «Нашу компанию» — кто платит по счёту (иначе расход не попадёт в «Деньги»; кнопка «Изменить» в счёте)');
    const sum = await this.linesSum(inv);
    if (Math.abs((Number(inv.amount) || 0) - sum) > 0.009) throw new BadRequestException('Сумма счёта не совпадает с суммой строк — исправьте цены позиций');
    const now = new Date();
    const by = actorId && Types.ObjectId.isValid(actorId) ? new Types.ObjectId(actorId) : undefined;
    await this.tx(async (session) => {
      await this.claimRequests({ invoiceId: inv._id }, session);
      const lines = await this.paymentLines(inv, session);
      const paymentSnapshot = { amount: sum, paidAt: now, ...(by ? { paidBy: by } : {}), lines };
      await this.model.updateOne({ _id: inv._id, status: 'issued' }, { $set: { status: 'paid', paidAt: now, paymentSnapshot }, $inc: { version: 1 } }, { session }).exec();
      // «Получено» оплата не откатывает в «Заказано» — только отметка оплаты (HARDEN-1 п.3)
      await this.requests.updateMany({ invoiceId: inv._id, deletedAt: null, status: { $nin: ['cancelled', 'received'] } },
        { $set: { paid: true, paidAt: now, status: 'ordered', editedInApp: true } }, { session }).exec();
      await this.requests.updateMany({ invoiceId: inv._id, deletedAt: null, status: 'received' },
        { $set: { paid: true, paidAt: now, editedInApp: true } }, { session }).exec();
      await this.recordPrices(inv, 'invoice_paid', session);
    });
    return this.get(id);
  }

  /**
   * ЗЯ-1 п.9: «Снять оплату» (только администратор). dryRun — план; confirm + причина — сторно: счёт снова «выставлен»,
   * строки без отметки оплаты, расход уходит из календаря. Запись о платеже не стирается: сумма, дата и причина —
   * в paymentAdjustments (operation payment_reversed) и в журнале. Есть приёмка — блок: сначала откатите приёмку.
   */
  async unpay(id: string, dto: { confirm?: boolean; reason?: string }, actor: OverrideActor, dryRun = false) {
    assertAdminActor(actor, 'Снятие оплаты');
    const inv = await this.load(id);
    if (this.ledger) {
      const result = await this.ledger.void(id, null, dto, actor, dryRun);
      return dryRun ? result : this.get(id);
    }
    if (inv.status !== 'paid') throw new BadRequestException('Счёт не оплачен — снимать нечего');
    const snap = inv.paymentSnapshot as { amount?: number; paidAt?: Date } | undefined;
    const amount = Number(snap?.amount ?? inv.amount) || 0;
    const when = snap?.paidAt ?? inv.paidAt;
    const blockers: string[] = [];
    const lock = await this.lockReason(inv);
    if (lock) blockers.push('По счёту есть приёмка на склад. Сначала откатите приёмку строк, потом снимайте оплату');
    const warnings = [
      `Оплата ${amount} ₽${when ? ` от ${new Date(when as Date).toLocaleDateString('ru-RU')}` : ''} будет снята: расход пропадёт из календаря и финансов`,
      'Счёт вернётся в «Выставлен», строки — в «В работе» без отметки об оплате; запись о платеже сохранится в истории счёта',
    ];
    if (dryRun) return { dryRun: true, canProceed: !blockers.length, warnings, blockers, relatedAction: 'Сторно оплаты и возврат строк в «В работе»' } satisfies OverridePlan;
    const reason = overrideConfirm(dto);
    if (blockers.length) throw new ConflictException(blockers[0]);
    const by = actor.id && Types.ObjectId.isValid(actor.id) ? new Types.ObjectId(actor.id) : undefined;
    await this.tx(async (session) => {
      await this.claimRequests({ invoiceId: inv._id }, session);
      const res = await this.model.updateOne({ _id: inv._id, status: 'paid', $or: [{ receiptBoundaryAt: null }, { receiptBoundaryAt: { $exists: false } }] },
        { $set: { status: 'issued' }, $unset: { paidAt: '', paymentSnapshot: '' }, $inc: { version: 1 },
          $push: { paymentAdjustments: { at: new Date(), ...(by ? { by } : {}), reason, operation: 'payment_reversed', beforeAmount: amount, afterAmount: 0, delta: -amount, requestIds: [] } } }, { session }).exec();
      if (!res.matchedCount) throw new ConflictException('Счёт изменился (оплата уже снята или началась приёмка) — обновите карточку');
      await this.requests.updateMany({ invoiceId: inv._id, deletedAt: null, status: { $nin: ['cancelled', 'received'] } }, { $set: { paid: false, status: 'ordered', editedInApp: true }, $unset: { paidAt: '' } }, { session }).exec();
    });
    await adminOverride(this.audit, {
      rule: 'supply.invoice_unpay', entityType: 'SupplyInvoice', entityId: id,
      before: { status: 'paid', amount, paidAt: when ?? null }, after: { status: 'issued', amount: 0 }, reason, actor,
    });
    return this.get(id);
  }

  /** Удалить счёт (мягко): оплаченный/принятый нельзя; заявки отвязываются и возвращаются в «Заказать». */
  async remove(id: string) {
    const inv = await this.load(id);
    if (inv.status === 'cancelled') throw new BadRequestException('Счёт отменён');
    if (inv.status === 'paid' || (inv.paymentAccountingVersion === 1 && Number(inv.paidAmount) > 0)) throw new BadRequestException('Оплаченный счёт или счёт с авансом нельзя удалить');
    const lock = await this.lockReason(inv);
    if (lock) throw new BadRequestException(`${lock} — удалить нельзя`);
    await this.tx(async (session) => {
      await this.claimRequests({ invoiceId: inv._id }, session);
      await this.touchFinancialInvoice(inv._id, session, inv.version);
      await this.requests.updateMany({ invoiceId: inv._id, deletedAt: null, status: 'ordered', paid: { $ne: true } }, { $set: { status: 'requested' } }, { session }).exec();
      await this.requests.updateMany({ invoiceId: inv._id }, { $unset: { invoiceId: '', invoiceNo: '', invoiceDate: '' }, $set: { editedInApp: true } }, { session }).setOptions({ includeSoftDeleted: true }).exec();
      await this.model.updateOne({ _id: inv._id }, { $set: { deletedAt: new Date() } }, { session }).exec();
    });
    return { id, deleted: true };
  }
}
