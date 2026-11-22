import { claimStockLinks } from '../../common/order-archive/write';
import { hasUndatedPayment, undatedBasis, undatedLocked } from './undated-payment';
import { ExpenseArticlesService } from '../expense-articles/expense-articles.service';
import { originalClassification } from '../../common/financial-classification';
import { invoicePaymentSummaries } from './invoice-payment-summary';
import { buildTree, articleOfCategory, type ArticleDoc } from '../expense-articles/articles-tree';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { createHash } from 'crypto';
import { Types, type ClientSession, type Connection, type Model } from 'mongoose';
import { oid } from '../../common/list-query';
import { assertAdminActor, overrideConfirm, type OverrideActor } from '../../common/admin-override';
import { ourCompanies } from '../incomes/incomes.service';
import { CreateInvoicePaymentDto, VoidInvoicePaymentDto } from './dto-invoice';
import { SupplyInvoice, type SupplyInvoiceDocument } from './supply-invoice.schema';
import { SupplyRequest, type SupplyRequestDocument } from './supply-request.schema';
import { SupplyInvoicePayment, type SupplyInvoicePaymentDocument } from './supply-invoice-payment.schema';
import { allocate, cents, factDate, financials, moscowToday, moneyValue, paymentTotals, roundMoney, type FinancialRecord as Row } from './invoice-financials';

const conflict = (message: string, code: string) => new ConflictException({ message, code });
const versionFilter = (inv: Row) => ({ _id: inv._id, deletedAt: null, ...(inv.version === undefined ? { version: { $exists: false } } : { version: inv.version }) });
const hashOf = (value: Row) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
@Injectable()
export class SupplyInvoicePaymentsService {
  constructor(@InjectConnection() private readonly connection: Connection,
    @InjectModel(SupplyInvoice.name) private readonly invoices: Model<SupplyInvoiceDocument>,
    @InjectModel(SupplyRequest.name) private readonly requests: Model<SupplyRequestDocument>,
    @InjectModel(SupplyInvoicePayment.name) private readonly payments: Model<SupplyInvoicePaymentDocument>, private readonly articles: ExpenseArticlesService) {}

  private async load(id: string, session?: ClientSession): Promise<Row> {
    const q = this.invoices.findOne({ _id: oid(id, 'счёта'), deletedAt: null });
    const row = await (session ? q.session(session) : q).lean().exec();
    if (!row) throw new NotFoundException('Счёт не найден');
    return row as Row;
  }
  private async lines(inv: Row, session?: ClientSession): Promise<Row[]> {
    const q = this.requests.find({ invoiceId: inv._id, deletedAt: null, status: { $ne: 'cancelled' } }).sort({ _id: 1 });
    return await (session ? q.session(session) : q).lean().exec() as Row[];
  }
  private scopedInvoice(inv: Row, lines: Row[], partial: boolean): Row {
    if (!partial) return inv;
    const visible = new Set(lines.map((x) => String(x._id || x.id)));
    const snapshot = inv.paymentSnapshot ? { ...inv.paymentSnapshot, lines: (inv.paymentSnapshot.lines || []).filter((x: Row) => visible.has(String(x.requestId))) } : null;
    if (snapshot) snapshot.amount = roundMoney(snapshot.lines.reduce((sum: number, x: Row) => sum + Number(x.lineAmount || 0), 0));
    const adjustments = (inv.paymentAdjustments || []).filter((x: Row) => (x.requestIds || []).some((id: unknown) => visible.has(String(id)))).map((x: Row) => ({ at: x.at, by: x.by, reason: x.reason, operation: x.operation, requestIds: x.requestIds.filter((id: unknown) => visible.has(String(id))), partial: true }));
    return { ...inv, undatedPaymentEvidence: undefined, undatedPaymentCommands: undefined, ...(!snapshot && inv.status === 'paid' && (inv.currency || 'RUB') === 'RUB' ? { reconciliationRequired: true, reconciliationReason: 'Для видимой части старой оплаты нет подтверждённого снимка. Нужна сверка; сумма оплаты и долг не рассчитаны.' } : {}), financialLines: Object.fromEntries(Object.entries(inv.financialLines || {}).filter(([id]) => visible.has(id))), amount: roundMoney(lines.reduce((sum, x) => sum + (Number(x.priceHint) || 0), 0)), confirmedAmountRub: null, declaredVatAmount: null, paymentSnapshot: snapshot, paymentAdjustments: adjustments, legacyClassifications: Object.fromEntries(Object.entries(inv.legacyClassifications || {}).filter(([id]) => visible.has(id))) };
  }
  async facts(ids: unknown[], limit?: number, visibleRequestIds?: unknown[], skip = 0): Promise<Row[]> {
    const filter = { invoiceId: { $in: ids }, ...(visibleRequestIds ? { 'allocations.requestId': { $in: visibleRequestIds } } : {}) };
    let q = this.payments.find(filter).sort({ date: -1, _id: -1 }).skip(skip);
    if (limit) q = q.limit(limit);
    const rows = ids.length ? await q.lean().exec() as Row[] : [];
    const fileIds = [...new Set(rows.flatMap((p) => (p.fileIds || []).map(String)))].map((id) => oid(String(id), 'файла'));
    const photos = fileIds.length ? await this.connection.db!.collection('photos').find({ _id: { $in: fileIds }, deletedAt: null }, { projection: { storageUrl: 1, originalFilename: 1, originalName: 1, name: 1, mimeType: 1 } }).toArray() : [];
    const byId = new Map(photos.map((p) => [String(p._id), { id: String(p._id), name: String(p.originalFilename || p.originalName || p.name || 'Подтверждение оплаты'), url: String(p.storageUrl), mime: p.mimeType ?? null }]));
    return rows.map((p) => ({ ...p, files: (p.fileIds || []).map((id: unknown) => byId.get(String(id))).filter(Boolean) }));
  }
  /** Итоги для списка и карточки: ни истории, ни файлов в этом пути нет. */
  summary(inv: Row, lines: Row[], aggregate?: Row, partial = false, includeHistory = false): Row {
    const scopedInv = this.scopedInvoice(inv, lines, partial), f = financials(scopedInv, lines);
    if (partial && f.currency !== 'RUB' && inv.confirmedAmountRub != null) {
      f.accountingAmountRub = scopedInv.amount; f.accountingState = 'resolved';
      f.requests = f.requests.map((x) => ({ ...x, accountingLineAmountRub: Number((x as Row).priceHint) || 0 }));
    }
    const totals = paymentTotals(scopedInv, f, aggregate ? [{ state: 'active', amount: aggregate.paidAmount, sourceAmount: aggregate.sourcePaidAmount }] : []);
    return { ...f, ...totals, undatedPaymentCommands: undefined, undatedPaymentEvidence: partial ? undefined : inv.undatedPaymentEvidence ? Object.fromEntries(Object.entries(inv.undatedPaymentEvidence).filter(([k]) => ['state', 'amountRub', 'sourceAmount', 'currency', 'payerCompanyId', 'reason', 'fileIds', 'confirmedAt', 'resolvedAt', 'resolvedPaymentId', 'revokedAt', 'revokeReason'].includes(k))) : undefined, ...(partial && hasUndatedPayment(inv) ? { requiresPaymentDate: true, paymentState: 'date_required', undatedConfirmedAmountRub: null, paidAmount: null, sourcePaidAmount: null, sourceBalance: null, balanceDue: null } : {}), warnings: totals.reconciliationRequired ? [...f.warnings, totals.reconciliationReason!] : f.warnings, ...(partial ? { confirmedAmountRub: null, declaredVatAmount: null, ...(includeHistory ? { financialLines: scopedInv.financialLines, legacyClassifications: scopedInv.legacyClassifications, paymentSnapshot: scopedInv.paymentSnapshot, paymentAdjustments: scopedInv.paymentAdjustments } : {}) } : {}), paymentsTotal: aggregate?.paymentsTotal || 0, paymentAccountingVersion: inv.paymentAccountingVersion ?? null, financialLocked: hasUndatedPayment(inv) || (inv.paymentAccountingVersion === 1 && Number(totals.paidAmount) > 0), financialLockReason: hasUndatedPayment(inv) ? 'Оплата подтверждена без даты — сначала заполните дату или снимите подтверждение' : inv.paymentAccountingVersion === 1 && Number(totals.paidAmount) > 0 ? 'Фактические платежи зафиксировали финансовую базу' : null };
  }
  /** Для частичного складского доступа возвращаются только суммы видимых allocations. */
  present(inv: Row, lines: Row[], facts: Row[], partial = false, aggregate?: Row, take = 100): Row {
    const visible = new Set(lines.map((x) => String(x._id || x.id)));
    const shown: Row[] = partial ? facts.map((p) => {
      const allocations = p.allocations.filter((a: Row) => visible.has(String(a.requestId)));
      return { ...p, amount: roundMoney(allocations.reduce((sum: number, a: Row) => sum + Number(a.amountRub), 0)), sourceAmount: roundMoney(allocations.reduce((sum: number, a: Row) => sum + Number(a.sourceAmount), 0)), allocations, partial: true };
    }).filter((p) => p.allocations.length) : facts;
    const totals = aggregate || { paidAmount: roundMoney(shown.filter((x) => x.state === 'active').reduce((sum, x) => sum + x.amount, 0)), sourcePaidAmount: roundMoney(shown.filter((x) => x.state === 'active').reduce((sum, x) => sum + x.sourceAmount, 0)), paymentsTotal: shown.length };
    const result = this.summary(inv, lines, totals, partial, true);
    result.warnings = [...new Set([...(result.warnings || []), ...shown.flatMap(p => p.allocations.flatMap((a: Row) => a.warnings || []))])];
    return { ...result, payments: shown.slice(0, take).map((p) => ({ ...p, id: String(p._id), effectiveRate: p.sourceAmount ? p.amount / p.sourceAmount : null, files: p.files || [] })) };
  }
  async list(id: string, q: Record<string, string | undefined>, visible?: Set<string>) {
    const inv = await this.load(id), lines = await this.lines(inv), scoped = visible ? lines.filter((x) => visible.has(String(x._id))) : lines;
    const page = Math.max(1, Number(q.page) || 1), limit = Math.min(200, Math.max(1, Number(q.limit) || 50));
    const ids = visible ? scoped.map((x) => x._id) : undefined;
    const [summaries, facts] = await Promise.all([invoicePaymentSummaries(this.connection, [inv._id], ids), this.facts([inv._id], limit, ids, (page - 1) * limit)]);
    const data = this.present(inv, scoped, facts, scoped.length < lines.length, summaries.get(String(inv._id)), limit);
    return { items: data.payments, total: data.paymentsTotal, page, limit, partial: scoped.length < lines.length, paymentState: data.paymentState };
  }
  private async allocations(inv: Row, lines: Row[], amount: number, sourceAmount: number, payer: Types.ObjectId, session: ClientSession) {
    const articles = await this.connection.db!.collection('expensearticles').find({ deletedAt: null }, { session }).toArray();
    const articleTree = buildTree(articles as unknown as ArticleDoc[]);
    const f = financials(inv, lines);
    const weights = f.requests.map((x) => ({ id: x.id, weight: x.sourceGrossAmount || 0 }));
    const rub = allocate(amount, weights), source = allocate(sourceAmount, weights);
    const result: Row[] = [];
    for (const line of lines) { const id = String(line._id);
      let articleId = line.articleId || articleOfCategory(articleTree, line.categoryId)?.id || null;
      const warnings: string[] = [];
      if (articleId) {
        try { await this.articles.assertSelectable(String(articleId), 'expense', { session }); }
        catch (error) { if (!(error instanceof BadRequestException)) throw error; articleId = null; warnings.push('Статья источника недоступна для новой оплаты — уточните статью'); }
      }
      result.push({ warnings,
      classificationOriginal: originalClassification({ articleId: articleId, salesOrderId: line.salesOrderId || null, costCenter: line.costCenter || null, costObject: line.costObject || null }), classificationProvenance: 'payment-snapshot',
      requestId: line._id, amountRub: rub.get(id) || 0, sourceAmount: source.get(id) || 0,
      title: line.title, num: line.num, qty: line.qty, invoiceNo: inv.no,
      supplierId: line.supplierId || inv.supplierId, supplierName: line.supplierName || inv.supplierName,
      categoryId: line.categoryId, articleId: articleId, salesOrderId: line.salesOrderId,
      costCenter: line.costCenter, costObject: line.costObject, payerCompanyId: payer,
    }); }
    return result;
  }
  snapshotAllocations(inv: Row, lines: Row[], amount: number, payer: Types.ObjectId, session: ClientSession) { return this.allocations(inv, lines, amount, amount, payer, session); }
  private async initLegacy(inv: Row, lines: Row[], session: ClientSession) {
    if (inv.paymentAccountingVersion === 1) return;
    if (paymentTotals(inv, financials(inv, lines), []).reconciliationRequired) throw conflict('Старая оплата требует сверки первичных документов', 'LEGACY_RECONCILIATION_REQUIRED');
    if (inv.status === 'paid' || lines.some((x) => x.paid)) {
      const snap = inv.paymentSnapshot;
      const amount = Number(snap?.amount ?? inv.amount);
      const dates = [...new Set(lines.map((x) => x.paidAt ? new Date(x.paidAt).toISOString().slice(0, 10) : ''))];
      const date = snap?.paidAt ? new Date(snap.paidAt).toISOString().slice(0, 10) : dates.length === 1 ? dates[0] : '';
      const total = roundMoney(lines.reduce((s, x) => s + Number(x.priceHint || 0), 0));
      const sourceLines = snap?.lines || lines.map((x) => ({ ...x, requestId: x._id, lineAmount: x.priceHint, companyId: x.companyId }));
      if (!(amount > 0) || !date || cents(amount) !== cents(total) || (!snap && lines.some((x) => !x.paid)) || cents(sourceLines.reduce((s: number, x: Row) => s + Number(x.lineAmount || 0), 0)) !== cents(amount) || sourceLines.length !== lines.length || new Set(sourceLines.map((x: Row) => String(x.requestId))).size !== lines.length || sourceLines.some((x: Row) => !lines.some((l) => String(l._id) === String(x.requestId)))) throw new ConflictException({ message: 'Старая оплата требует сверки суммы, строк и фактической даты', code: 'LEGACY_RECONCILIATION_REQUIRED', plan: { readOnly: true, invoiceId: String(inv._id), invoiceAmount: inv.amount, snapshotAmount: snap?.amount ?? null, liveLinesAmount: total, date: date || null, action: 'Сверьте первичку и историю оплаты; автоматический перенос не выполнен' } });
      factDate(date);
      const payer = inv.payerCompanyId;
      if (!payer) throw conflict('У старой оплаты не указана наша компания', 'LEGACY_RECONCILIATION_REQUIRED');
      const currentById = new Map(lines.map((x) => [String(x._id), x]));
      const articleTree = buildTree(await this.connection.db!.collection('expensearticles').find({ deletedAt: null }, { session }).toArray() as unknown as ArticleDoc[]);
      const carried = sourceLines.map((x: Row) => {
        const key = String(x.requestId), stored = inv.legacyClassifications?.[key], current = currentById.get(key);
        if (stored && !stored.classificationOriginal) throw conflict('История уточнения старой оплаты требует сверки перед переходом', 'LEGACY_CLASSIFICATION_RECONCILIATION_REQUIRED');
        const provenance = x.articleId ? 'payment-snapshot' : current?.articleId ? 'current-request' : current?.categoryId || x.categoryId ? 'category-hint' : 'legacy-none';
        const original = stored?.classificationOriginal || originalClassification({ articleId: x.articleId || current?.articleId || articleOfCategory(articleTree, current?.categoryId || x.categoryId)?.id || null, salesOrderId: x.salesOrderId || current?.salesOrderId || null, costCenter: x.costCenter || current?.costCenter || null, costObject: x.costObject || current?.costObject || null });
        return { ...x, amountRub: Number(x.lineAmount), sourceAmount: Number(x.lineAmount), payerCompanyId: x.companyId || payer, ...(stored || {}), classificationOriginal: original, classificationProvenance: stored?.classificationProvenance || provenance, originOperationId: 'supply-legacy:' + String(inv._id) + ':' + key };
      });
      await this.payments.create([{ invoiceId: inv._id, clientUid: `legacy:${String(inv._id)}`, requestHash: 'legacy', date, amount, sourceAmount: amount, currency: 'RUB', payerCompanyId: payer, state: 'active', createdBy: snap?.paidBy, fileIds: [], allocations: carried }], { session });
    }
    // Маркер фиксируется общей CAS-записью вместе с новой операцией; чтение не меняет данные.
  }
  private async synchronize(inv: Row, lines: Row[], session: ClientSession) {
    const linked = await this.requests.find({ invoiceId: inv._id, deletedAt: null, status: { $ne: 'cancelled' } }, { salesOrderId: 1, salesOrderLineId: 1 }).session(session).lean().exec();
    await claimStockLinks(this.connection.db!, session, linked);
    const facts = await this.payments.find({ invoiceId: inv._id }).session(session).lean().exec() as Row[];
    const totals = paymentTotals({ ...inv, paymentAccountingVersion: 1 }, financials(inv, lines), facts);
    const active = facts.filter((p) => p.state === 'active').sort((a, b) => a.date.localeCompare(b.date));
    const paidAt = totals.paymentState === 'paid' ? new Date(active[active.length - 1].date + 'T00:00:00Z') : undefined;
    const res = await this.invoices.updateOne(versionFilter(inv), { $set: { paymentAccountingVersion: 1, paidAmount: totals.paidAmount, sourcePaidAmount: totals.sourcePaidAmount, status: totals.paymentState === 'paid' ? 'paid' : 'issued', ...(inv.undatedPaymentEvidence ? { undatedPaymentEvidence: inv.undatedPaymentEvidence } : {}), ...(paidAt ? { paidAt } : {}) }, ...(!paidAt ? { $unset: { paidAt: '' } } : {}), $inc: { version: 1 } }, { session }).exec();
    if (!res.matchedCount) throw conflict('Счёт изменился — обновите карточку', 'INVOICE_VERSION_CONFLICT');
    await this.requests.updateMany({ invoiceId: inv._id, deletedAt: null, status: { $ne: 'cancelled' } }, { $set: { paid: totals.paymentState === 'paid', ...(paidAt ? { paidAt } : {}), editedInApp: true }, ...(!paidAt ? { $unset: { paidAt: '' } } : {}) }, { session }).exec();
  }
  async refreshAfterAdjustment(id: string, session: ClientSession) {
    const inv = await this.load(id, session);
    await this.synchronize(inv, await this.lines(inv, session), session);
  }
  private canonical(inv: Row, dto: CreateInvoicePaymentDto) {
    const sourceAmount = (inv.currency || 'RUB') === 'RUB' ? dto.amount : dto.sourceAmount;
    if (sourceAmount === undefined) throw new BadRequestException('Укажите сумму погашения в валюте документа');
    moneyValue(dto.amount, 'Сумма оплаты', true); moneyValue(sourceAmount, 'Сумма в валюте', true); factDate(dto.date);
    if ((inv.currency || 'RUB') === 'RUB' && dto.sourceAmount !== undefined && dto.sourceAmount !== dto.amount) throw new BadRequestException('В рублёвом документе исходная сумма равна оплате');
    if (dto.exchangeRate !== undefined && (!(dto.exchangeRate > 0) || !dto.exchangeRateDate || !dto.exchangeRateSource?.trim())) throw new BadRequestException('Укажите дату и основание курса платежа');
    if (dto.exchangeRateDate) factDate(dto.exchangeRateDate);
    return { date: dto.date, amount: dto.amount, sourceAmount, payerCompanyId: String(dto.payerCompanyId || inv.payerCompanyId || ''), exchangeRate: dto.exchangeRate ?? null, exchangeRateDate: dto.exchangeRateDate || null, exchangeRateSource: dto.exchangeRateSource?.trim() || null, fileIds: [...new Set(dto.fileIds || [])].sort(), note: dto.note?.trim() || '' };
  }
  async add(id: string, dto: CreateInvoicePaymentDto, actorId?: string, onFullyPaid?: (invoice: Row, session: ClientSession) => Promise<void>, allowUndated = true) {
    if (!dto.clientUid?.trim() || dto.clientUid.length > 100) throw new BadRequestException('Укажите ключ clientUid платежа');
    const first = await this.load(id), requestHash = hashOf({ date: dto.date, amount: dto.amount, sourceAmount: dto.sourceAmount ?? null, payerCompanyId: dto.payerCompanyId || null, exchangeRate: dto.exchangeRate ?? null, exchangeRateDate: dto.exchangeRateDate || null, exchangeRateSource: dto.exchangeRateSource?.trim() || null, fileIds: [...new Set(dto.fileIds || [])].sort(), note: dto.note?.trim() || '' });
    const repeat = await this.payments.findOne({ invoiceId: first._id, clientUid: dto.clientUid }).lean().exec();
    if (repeat) { if (repeat.requestHash !== requestHash) throw conflict('Ключ платежа уже использован с другими данными', 'IDEMPOTENCY_CONFLICT'); return; }
    const expectedVersion = dto.version ?? Number(first.version || 0);
    const canonical = this.canonical(first, dto);
    const payer = oid(canonical.payerCompanyId, 'нашей компании');
    if (!(await ourCompanies(this.connection)).some((x) => String(x.id) === String(payer))) throw new BadRequestException('Плательщик должен быть нашей действующей компанией');
    if (canonical.fileIds.length && await this.connection.db!.collection('photos').countDocuments({ _id: { $in: canonical.fileIds.map((x) => oid(x, 'файла')) }, deletedAt: null }) !== canonical.fileIds.length) throw new BadRequestException('Часть файлов подтверждения не найдена');
    const session = await this.connection.startSession();
    try {
      await session.withTransaction(async () => {
        const inv = await this.load(id, session);
        const prior = await this.payments.findOne({ invoiceId: inv._id, clientUid: dto.clientUid }).session(session).lean().exec();
        if (prior) { if (prior.requestHash !== requestHash) throw conflict('Ключ платежа использован с другими данными', 'IDEMPOTENCY_CONFLICT'); return; }
        if (expectedVersion !== Number(inv.version || 0)) throw conflict('Счёт изменился — обновите карточку', 'INVOICE_VERSION_CONFLICT');
        if (inv.status !== 'issued' && inv.status !== 'paid') throw conflict('Сначала выставьте счёт', 'INVOICE_NOT_ISSUED');
        const lines = await this.lines(inv, session), f = financials(inv, lines);
        if (f.sourceAmount === null || !(f.sourceAmount > 0)) throw conflict('Заполните исходные суммы строк', 'SOURCE_AMOUNT_REQUIRED');
        const undated = hasUndatedPayment(inv) ? inv.undatedPaymentEvidence : null;
        if (undated && !allowUndated) throw undatedLocked();
        if (undated && (f.currency !== 'RUB' || cents(canonical.amount) !== cents(undated.amountRub) || cents(canonical.sourceAmount) !== cents(undated.sourceAmount) || String(payer) !== String(undated.payerCompanyId) || undatedBasis(inv, lines) !== undated.basisHash)) throw undatedLocked();
        await this.initLegacy(inv, lines, session);
        const facts = await this.payments.find({ invoiceId: inv._id }).session(session).lean().exec() as Row[];
        const totals = paymentTotals({ ...inv, undatedPaymentEvidence: undefined, paymentAccountingVersion: 1 }, f, facts);
        if (cents(canonical.sourceAmount) > cents(totals.sourceBalance || 0)) throw conflict('Сумма оплаты превышает непогашенный остаток', 'PAYMENT_EXCEEDS_BALANCE');
        if ((inv.currency || 'RUB') === 'RUB' && cents(Number(inv.amount)) !== cents(Number(f.sourceAmount))) throw conflict('Сумма счёта не совпадает со строками', 'INVOICE_AMOUNT_MISMATCH');
        const [created] = await this.payments.create([{ ...canonical, payerCompanyId: payer, fileIds: canonical.fileIds.map((x) => oid(x, 'файла')), invoiceId: inv._id, clientUid: dto.clientUid, requestHash, currency: f.currency, currencyName: inv.currencyName, createdBy: actorId ? oid(actorId, 'автора') : undefined, state: 'active', allocations: undated ? undated.allocations : await this.allocations(inv, lines, canonical.amount, canonical.sourceAmount, payer, session) }], { session });
        if (undated) inv.undatedPaymentEvidence = { ...undated, state: 'resolved', resolvedAt: new Date(), resolvedPaymentId: created._id };
        await this.synchronize(inv, lines, session);
        if (onFullyPaid && totals.paymentState !== 'paid' && cents(canonical.sourceAmount) === cents(totals.sourceBalance || 0)) await onFullyPaid(inv, session);
      });
    } catch (error) {
      const saved = await this.payments.findOne({ invoiceId: first._id, clientUid: dto.clientUid }).lean().exec();
      if (saved && saved.requestHash === requestHash) return;
      throw error;
    } finally { await session.endSession(); }
  }
  async payRemaining(id: string, actorId?: string, onFullyPaid?: (invoice: Row, session: ClientSession) => Promise<void>) {
    const inv = await this.load(id);
    if (hasUndatedPayment(inv)) throw undatedLocked();
    const f = financials(inv, await this.lines(inv));
    if (paymentTotals(inv, f, []).reconciliationRequired) throw conflict('Старая оплата требует сверки первичных документов', 'LEGACY_RECONCILIATION_REQUIRED');
    if (inv.status === 'paid') return;
    const aggregate = (await invoicePaymentSummaries(this.connection, [inv._id])).get(String(inv._id));
    const totals = paymentTotals(inv, f, aggregate ? [{ state: 'active', amount: aggregate.paidAmount, sourceAmount: aggregate.sourcePaidAmount }] : []);
    if (totals.balanceDue === null || !(totals.balanceDue > 0)) throw conflict('Для оплаты уточните рублёвый пересчёт', 'CONVERSION_REQUIRED');
    await this.add(id, { clientUid: `pay:${id}:${Number(inv.version || 0)}`, date: moscowToday(), amount: totals.balanceDue, ...(f.currency !== 'RUB' ? { sourceAmount: totals.sourceBalance! } : {}), version: Number(inv.version || 0) }, actorId, onFullyPaid, false);
  }
  async void(id: string, paymentId: string | null, dto: VoidInvoicePaymentDto, actor: OverrideActor, dryRun: boolean) {
    assertAdminActor(actor, 'Сторно оплаты');
    const inv = await this.load(id), lines = await this.lines(inv);
    if (hasUndatedPayment(inv)) throw undatedLocked();
    const payment = paymentId ? await this.payments.findOne({ _id: oid(paymentId, 'платежа'), invoiceId: inv._id }).lean().exec() : null;
    if (paymentId && !payment) throw new NotFoundException('Платёж не найден в этом счёте');
    if (payment?.state === 'voided' && payment.voidClientUid === dto.clientUid) {
      if (payment.voidReason !== dto.reason?.trim()) throw conflict('Ключ сторно уже использован с другими данными', 'IDEMPOTENCY_CONFLICT');
      return { dryRun: false, repeated: true };
    }
    const blockers: string[] = [];
    if (inv.receiptBoundaryAt || lines.some((x) => x.status === 'received')) blockers.push('По счёту есть приёмка: сначала откатите приёмку строк');
    const hasActive = await this.payments.exists({ invoiceId: inv._id, state: 'active' });
    if (paymentId && payment?.state === 'voided') blockers.push('Этот платёж уже сторнирован');
    if (dryRun) return { dryRun: true, canProceed: !blockers.length, warnings: ['Ошибочная оплата будет исключена из своего периода; запись останется в истории. Это не возврат денег.'], blockers, relatedAction: 'Сторно оплаты' };
    const reason = overrideConfirm(dto);
    if (paymentId && !dto.clientUid) throw new BadRequestException('Для сторно укажите ключ clientUid');
    if (blockers.length) throw conflict(blockers[0], 'RECEIPT_BOUNDARY');
    if (inv.paymentAccountingVersion === 1 && !hasActive) return { repeated: true };
    const session = await this.connection.startSession();
    try { await session.withTransaction(async () => {
      const fresh = await this.load(id, session), currentLines = await this.lines(fresh, session);
      if (hasUndatedPayment(fresh)) throw undatedLocked();
      if (paymentId) {
        const current = await this.payments.findOne({ _id: oid(paymentId, 'платежа'), invoiceId: fresh._id }).session(session).lean().exec();
        if (current?.state === 'voided' && current.voidClientUid === dto.clientUid && current.voidReason === reason) return;
      }
      if (dto.version !== undefined && Number(fresh.version || 0) !== dto.version) throw conflict('Счёт изменился — обновите карточку', 'INVOICE_VERSION_CONFLICT');
      if (fresh.receiptBoundaryAt || currentLines.some((x) => x.status === 'received')) throw conflict('Сначала откатите приёмку', 'RECEIPT_BOUNDARY');
      await this.initLegacy(fresh, currentLines, session);
      const result = await this.payments.updateMany({ invoiceId: fresh._id, state: 'active', ...(paymentId ? { _id: oid(paymentId, 'платежа') } : {}) }, { $set: { state: 'voided', voidedAt: new Date(), voidedBy: actor.id ? oid(actor.id, 'автора') : undefined, voidReason: reason, voidClientUid: dto.clientUid || `unpay:${id}:${Number(fresh.version || 0)}` } }, { session }).exec();
      if (paymentId && !result.modifiedCount) throw conflict('Оплата уже изменилась', 'PAYMENT_VERSION_CONFLICT');
      const remaining = await this.payments.find({ invoiceId: fresh._id, state: 'active' }).session(session).lean().exec();
      const beforeAmount = Number(fresh.paidAmount ?? fresh.paymentSnapshot?.amount ?? fresh.amount) || 0;
      const afterAmount = roundMoney(remaining.reduce((sum, p) => sum + p.amount, 0));
      await this.synchronize(fresh, currentLines, session);
      await this.invoices.updateOne({ _id: fresh._id }, { $push: { paymentAdjustments: { at: new Date(), by: actor.id ? oid(actor.id, 'автора') : undefined, reason, operation: 'payment_reversed', beforeAmount, afterAmount, delta: roundMoney(afterAmount - beforeAmount), requestIds: currentLines.map((x) => x._id) } } }, { session }).exec();
    }); } finally { await session.endSession(); }
    return { dryRun: false, voided: true };
  }
}
