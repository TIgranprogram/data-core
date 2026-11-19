import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { type ClientSession, type Connection } from 'mongoose';
import { createHash } from 'crypto';
import { oid } from '../../common/list-query';
import { versionFilter } from '../../common/versioned';
import { canSeeMoney, canSeePayroll, effectiveRoles } from '../../common/roles-hierarchy';
import { openSectionsFor, sectionOpen } from '../../common/app-sections';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import type { StockScope } from '../../common/stock-scope';
import { docScopeMatch } from '../../common/supply-scope';
import { CLASSIFICATION_FIELDS, effectiveClassification, originalClassification } from '../../common/financial-classification';
import { ExpenseArticlesService } from '../expense-articles/expense-articles.service';
import { articleOfCategory, buildTree } from '../expense-articles/articles-tree';
import { financials, legacyReconciliation, type FinancialRecord as Row } from '../supply/invoice-financials';
import { incomePayments } from '../incomes/income.schema';
import { incomeIdentityHash } from '../incomes/income-payment-identities';
import { ClassificationDto } from './operations.dto';
type Address = { collection: string; document: Row; metadata: Row; path: string | null; operationId: string; sourceId: string; date: string; companyId: string; source: 'invoice' | 'request' | 'income' | 'expense' | 'payroll'; invoiceId?: unknown; requestId?: unknown; editable: boolean; reason?: string; amount: number };
const day = (value: unknown) => new Date(String(value)).toISOString().slice(0, 10);
@Injectable()
export class FinancialClassificationService {
  constructor(@InjectConnection() private readonly connection: Connection, private readonly articles: ExpenseArticlesService) {}
  private get db() { return this.connection.db!; }
  /** Адрес источника не зависит от эффективного аналитического заказа. Временный income reference только читается. */
  async locate(operationId: string, session?: ClientSession): Promise<Address> {
    const bits = operationId.split(':'), kind = bits[0], options = session ? { session } : {};
    const find = async (collection: string, id: string) => { const doc = await this.db.collection(collection).findOne({ _id: oid(id, 'источника'), deletedAt: null }, options); if (!doc) throw new NotFoundException('Источник операции не найден'); return doc as Row; };
    if (kind === 'expense' && bits.length === 2) {
      const doc = await find('expenses', bits[1]); return { collection: 'expenses', document: doc, metadata: doc, path: null, operationId, sourceId: bits[1], date: day(doc.date), companyId: String(doc.companyId || ''), source: 'expense', editable: true, amount: Number(doc.amount) };
    }
    if ((kind === 'income' && bits.length === 3) || (kind === 'income-unprepared' && bits.length === 4)) {
      const doc = await find('incomes', bits[1]); if (doc.cancelledAt) throw new NotFoundException('Позиция отменена');
      const payments = incomePayments(doc), temporary = kind === 'income-unprepared';
      if (temporary && incomeIdentityHash(doc) !== bits[2]) throw new NotFoundException({ message: 'Источник изменился: перечитайте список операций', code: 'STALE_OPERATION_REFERENCE' });
      const index = temporary ? Number(bits[3]) : payments.findIndex(p => p.paymentId === bits[2]);
      if (!Number.isInteger(index) || index < 0 || !payments[index]) throw new NotFoundException('Платёж операции не найден');
      const payment = payments[index] as Row, synthetic = !doc.payments?.length;
      return { collection: 'incomes', document: doc, metadata: { ...payment, salesOrderId: doc.orderId || null }, path: synthetic ? 'legacyPaymentMetadata' : 'payments.' + index, operationId, sourceId: bits[1], date: day(payment.date), companyId: String(payment.companyId || doc.companyId || ''), source: 'income', editable: !temporary && !!payment.paymentId, reason: temporary ? 'Сначала подготовьте историю оплат: этот адрес только для чтения' : undefined, amount: Number(payment.amount) };
    }
    if (kind === 'supply-payment' && bits.length === 3) {
      const doc = await find('supplyinvoicepayments', bits[1]); if (doc.state !== 'active') throw new NotFoundException('Платёж сторнирован');
      await find('supplyinvoices', String(doc.invoiceId));
      const index = (doc.allocations as Row[]).findIndex(a => String(a.requestId) === bits[2]);
      if (index < 0) throw new NotFoundException('Распределение оплаты не найдено');
      return { collection: 'supplyinvoicepayments', document: doc, metadata: doc.allocations[index], path: 'allocations.' + index, operationId, sourceId: bits[1], date: String(doc.date), companyId: String(doc.payerCompanyId || ''), source: 'invoice', invoiceId: doc.invoiceId, requestId: doc.allocations[index].requestId, editable: true, amount: Number(doc.allocations[index].amountRub) };
    }
    if (kind === 'supply-legacy' && bits.length === 3) {
      const doc = await find('supplyinvoices', bits[1]);
      if (doc.paymentAccountingVersion === 1) {
        const migrated = await this.db.collection('supplyinvoicepayments').findOne({ invoiceId: doc._id, state: 'active', $or: [{ 'allocations.originOperationId': operationId }, { clientUid: 'legacy:' + bits[1], 'allocations.requestId': oid(bits[2], 'заявки') }] }, options);
        if (!migrated) throw new NotFoundException('Историческая операция уже не является активным фактом');
        return this.locate('supply-payment:' + String(migrated._id) + ':' + bits[2], session);
      }
      const rows = await this.db.collection('supplyrequests').find({ invoiceId: doc._id, deletedAt: null, status: { $ne: 'cancelled' } }, options).toArray();
      const request = rows.find(r => String(r._id) === bits[2]), snap = doc.paymentSnapshot, line = (snap?.lines || []).find((r: Row) => String(r.requestId) === bits[2]);
      if (!line && (!request?.paid || doc.status !== 'paid')) throw new NotFoundException('Историческая оплата не найдена');
      const reconciliation = legacyReconciliation(doc, financials(doc, rows));
      const stored = doc.legacyClassifications?.[bits[2]], tree = buildTree(await this.articles.docs({ session }));
      const provenance = line?.articleId ? 'payment-snapshot' : request?.articleId ? 'current-request' : request?.categoryId || line?.categoryId ? 'category-hint' : 'legacy-none';
      const metadata = stored || { articleId: line?.articleId || request?.articleId || articleOfCategory(tree, request?.categoryId || line?.categoryId)?.id || null, salesOrderId: line?.salesOrderId || request?.salesOrderId || null, costCenter: line?.costCenter || request?.costCenter || null, costObject: line?.costObject || request?.costObject || null, classificationProvenance: provenance };
      return { collection: 'supplyinvoices', document: doc, metadata, path: 'legacyClassifications.' + bits[2], operationId, sourceId: bits[1], date: day(snap?.paidAt || request?.paidAt || request?.invoiceDate), companyId: String(line?.companyId || doc.payerCompanyId || request?.companyId || ''), source: 'invoice', invoiceId: doc._id, requestId: oid(bits[2], 'заявки'), editable: !reconciliation, reason: reconciliation?.reason, amount: Number(line?.lineAmount ?? request?.priceHint) };
    }
    if (kind === 'supply-request' && bits.length === 2) {
      const doc = await find('supplyrequests', bits[1]); if (doc.invoiceId) return this.locate('supply-legacy:' + String(doc.invoiceId) + ':' + bits[1], session);
      if (!doc.paid || doc.status === 'cancelled') throw new NotFoundException('Подтверждённая оплата не найдена');
      return { collection: 'supplyrequests', document: doc, metadata: doc, path: null, operationId, sourceId: bits[1], date: day(doc.paidAt || doc.invoiceDate), companyId: String(doc.companyId || ''), source: 'request', requestId: doc._id, editable: false, reason: 'Старая заявка без счёта: требуется отдельный адаптер сверки', amount: Number(doc.priceHint) };
    }
    if (kind === 'payroll' && bits.length === 2) { const doc = await find('payroll_payments', bits[1]); const payroll = (await this.articles.docs({ session })).find(a => a.code === 'payroll'); return { collection: 'payroll_payments', document: doc, metadata: { ...doc, articleId: payroll?._id || null }, path: null, operationId, sourceId: bits[1], date: day(doc.date), companyId: String(doc.companyId || ''), source: 'payroll', editable: true, amount: Number(doc.amount) }; }
    throw new NotFoundException('Адрес денежной операции не найден');
  }
  async assertAccess(target: Address, actor: AuthenticatedUser | undefined, scope: StockScope | null, write = false) {
    if (!actor || !canSeeMoney(actor)) throw new ForbiddenException('Нет доступа к денежным данным');
    if (actor.keyScope?.access === 'read' && write) throw new ForbiddenException('Ключ разрешает только чтение');
    if (target.source === 'payroll' && !canSeePayroll(actor)) throw new ForbiddenException('Нет доступа к выплатам ФОТ');
    const sections = target.source === 'income' ? ['orders', 'salesorders'] : target.source === 'invoice' || target.source === 'request' ? ['requests'] : target.source === 'payroll' ? ['payroll'] : ['money'];
    if (!sections.some(s => sectionOpen(openSectionsFor(actor), s))) throw new ForbiddenException('Раздел исходного документа закрыт для вашей роли');
    if (write && !effectiveRoles(actor.role).some(r => r === 'manager' || r === 'admin') && !actor.isOwner) throw new ForbiddenException('Нет права менять классификацию источника');
    if (scope && target.requestId) {
      const sc = await docScopeMatch(this.connection, scope);
      if (!await this.db.collection('supplyrequests').findOne({ _id: target.requestId, deletedAt: null, ...sc })) throw new ForbiddenException('Операция не из вашего склада');
      if (write && target.invoiceId) {
        const [all, visible] = await Promise.all([this.db.collection('supplyrequests').countDocuments({ invoiceId: target.invoiceId, deletedAt: null }), this.db.collection('supplyrequests').countDocuments({ invoiceId: target.invoiceId, deletedAt: null, ...sc })]);
        if (all !== visible) throw new ForbiddenException('В счёте есть заявки не из вашего склада');
      }
    }
  }
  async apply(operationId: string, dto: ClassificationDto, actor: AuthenticatedUser, scope: StockScope | null) {
    const reason = dto.reason.trim(); if (reason.length < 3) throw new BadRequestException('Укажите причину от3символов');
    const patch: Row = {}; for (const field of CLASSIFICATION_FIELDS) if (Object.prototype.hasOwnProperty.call(dto, field)) patch[field] = dto[field] == null || dto[field] === '' ? null : String(dto[field]).trim();
    if (dto.resetToOriginal && Object.keys(patch).length) throw new BadRequestException('Возврат к исходному не смешивается с новыми полями');
    if (!dto.resetToOriginal && !Object.keys(patch).length) throw new BadRequestException('Выберите хотя бы одно уточнение');
    const requestHash = createHash('sha256').update(JSON.stringify({ patch, reason, resetToOriginal: dto.resetToOriginal === true })).digest('hex');
    const session = await this.connection.startSession(); let actualOperationId = operationId; let replayed: Row | undefined;
    try { await session.withTransaction(async () => {
      const target = await this.locate(operationId, session); actualOperationId = target.operationId;
      await this.assertAccess(target, actor, scope, true);
      if (!target.editable) throw new ConflictException({ message: target.reason || 'Классификация источника пока недоступна', code: 'CLASSIFICATION_READ_ONLY', plan: { readOnly: true, sourceId: target.sourceId, action: 'Сначала подготовьте источник или выполните сверку' } });
      const metadata = target.metadata, prior = (metadata.classificationHistory || []).find((h: Row) => h.clientUid === dto.clientUid);
      if (prior) { if (prior.requestHash !== requestHash) throw new ConflictException('Ключ уточнения уже использован с другими данными'); replayed = prior; return; }
      if (Number(metadata.classificationVersion || 0) !== dto.version) throw new ConflictException({ message: 'Классификация уже изменена — перечитайте операцию', currentVersion: Number(metadata.classificationVersion || 0) });
      if (patch.articleId) await this.articles.assertSelectable(patch.articleId, target.source === 'income' ? 'income' : 'expense', { session });
      if (patch.salesOrderId && !await this.db.collection('salesorders').findOne({ _id: oid(patch.salesOrderId, 'объекта'), deletedAt: null }, { session })) throw new BadRequestException('Аналитический объект не найден');
      const original = originalClassification(metadata), before = effectiveClassification(metadata), override = dto.resetToOriginal ? {} : { ...(metadata.classificationOverride || {}), ...patch };
      const after = effectiveClassification({ classificationOriginal: original, classificationOverride: override });
      const version = dto.version + 1, history = [...(metadata.classificationHistory || []), { at: new Date(), by: actor.id, authorName: actor.username, reason, clientUid: dto.clientUid, requestHash, version, before, after, original, override: { ...override }, resetToOriginal: dto.resetToOriginal === true }];
      const updated = { ...metadata, classificationOriginal: original, classificationOverride: override, classificationVersion: version, classificationHistory: history };
      const set = target.path ? { [target.path]: updated } : { classificationOriginal: original, classificationOverride: override, classificationVersion: version, classificationHistory: history };
      const changed = await this.db.collection(target.collection).updateOne({ _id: target.document._id, deletedAt: null, ...versionFilter(Number(target.document.version || 0)), ...(target.collection === 'supplyinvoicepayments' ? { state: 'active' } : {}) }, { $set: set, $inc: { version: 1 } }, { session });
      if (!changed.matchedCount) throw new ConflictException('Источник уже изменён — перечитайте операцию');
      await this.db.collection('auditlogs').insertOne({ action: 'finance.classification.updated', entityType: target.source === 'income' ? 'Income' : target.source === 'expense' ? 'Expense' : target.source === 'payroll' ? 'PayrollPayment' : target.collection === 'supplyinvoices' ? 'SupplyInvoice' : 'SupplyInvoicePayment', entityId: target.document._id, userId: oid(actor.id, 'автора'), userName: actor.username, createdAt: new Date(), details: { before, after, meta: { operationId: target.operationId, clientUid: dto.clientUid, reason, version, resetToOriginal: dto.resetToOriginal === true, factUnchanged: { amount: target.amount, date: target.date, companyId: target.companyId } } } }, { session });
    }); } finally { await session.endSession(); }
    return { operationId: actualOperationId, replayed };
  }
}
