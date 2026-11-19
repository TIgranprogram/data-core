import { originalClassification, effectiveClassification } from '../../common/financial-classification';
import { moscowToday } from '../supply/invoice-financials';
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { type Connection } from 'mongoose';
import { canSeeMoney, canSeePayroll, effectiveRoles } from '../../common/roles-hierarchy';
import { openSectionsFor, sectionOpen } from '../../common/app-sections';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import type { StockScope } from '../../common/stock-scope';
import { docScopeMatch } from '../../common/supply-scope';
import { oid } from '../../common/list-query';
import { ourCompanies } from '../incomes/incomes.service';
import { parseDay } from '../expenses/expense-rules';
import { buildFinancialTree, flattenFinancialTree, articleDescendants } from '../expense-articles/articles-tree';
import { ExpenseArticlesService } from '../expense-articles/expense-articles.service';
import { FinanceService } from './finance.service';
import { FinancialClassificationService } from './financial-classification.service';
import type { Op } from './cashflow';
import { buildFinancialArticleReport } from './financial-article-report';
type Query = Record<string, unknown>;
@Injectable()
export class FinancialOperationsReader {
  constructor(@InjectConnection() private readonly connection: Connection, private readonly finance: FinanceService, private readonly articles: ExpenseArticlesService, private readonly classifications: FinancialClassificationService) {}
  async filtered(q: Query, actor?: AuthenticatedUser, scope: StockScope | null = null) {
    if (!actor || !canSeeMoney(actor)) throw new ForbiddenException('Нет доступа к денежным данным');
    const today = moscowToday(), year = Number(q.year || today.slice(0, 4));
    if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new BadRequestException('Проверьте год');
    const from = String(q.from || year + '-01-01'), to = String(q.to || (q.year ? year + '-12-31' : today));
    const span = (parseDay(to).getTime() - parseDay(from).getTime()) / 86400000;
    if (span < 0 || span > 365) throw new BadRequestException('Период — от1 до366дней');
    const all = await ourCompanies(this.connection), company = String(q.companyId || q.org || 'all');
    const used = company === 'all' ? all : all.filter(c => String(c.id) === company || c.name.toLowerCase() === company.toLowerCase() || c.full.toLowerCase() === company.toLowerCase());
    if (!used.length) throw new BadRequestException('Выберите нашу действующую компанию');
    const sources = ['invoice', 'request', 'income', 'expense', 'payroll', 'supply'];
    if (q.source && !sources.includes(String(q.source))) throw new BadRequestException('Неизвестный источник операций');
    if (q.type && !['income', 'expense'].includes(String(q.type))) throw new BadRequestException('Выберите поступление или выплату');
    const [ops, docs] = await Promise.all([this.finance.operationsSource(from, to, used.map(c => c.id), q.source ? String(q.source) : undefined), this.articles.docs({ includeDeleted: true })]);
    const tree = buildFinancialTree(docs, { includeArchived: true }), flat = flattenFinancialTree(tree.items), byId = new Map(flat.map(n => [n.id, n]));
    const articleId = q.articleId ? String(q.articleId) : null;
    if (articleId && articleId !== 'none') oid(articleId, 'статьи');
    const articleIds = articleId && articleId !== 'none' ? new Set(Number(q.includeDescendants ?? 1) ? [articleId, ...articleDescendants(tree.items, articleId)] : [articleId]) : null;
    const orderId = q.salesOrderId || (q.mode === 'object' ? q.order : undefined);
    if (orderId) oid(String(orderId), 'аналитического объекта');
    const originalIds = ops.filter(o => o.scopeRequestId).map(o => oid(o.scopeRequestId!, 'заявки'));
    const visible = scope && originalIds.length ? new Set((await this.connection.db!.collection('supplyrequests').find({ _id: { $in: originalIds }, deletedAt: null, ...await docScopeMatch(this.connection, scope) }, { projection: { _id: 1 } }).toArray()).map(r => String(r._id))) : null;
    const open = openSectionsFor(actor);
    const excludedSources = [{ source: 'invoice', sections: ['requests'], allowed: true }, { source: 'request', sections: ['requests'], allowed: true }, { source: 'income', sections: ['orders', 'salesorders'], allowed: true }, { source: 'payroll', sections: ['payroll'], allowed: canSeePayroll(actor) }].filter(s => !s.allowed || !s.sections.some(id => sectionOpen(open, id))).map(s => ({ source: s.source, reason: 'Недоступен исходный раздел или его денежные права' }));
    const result: Op[] = [];
    for (const op of ops) {
      if (!op.operationId || op.date > today || !(op.amount > 0)) continue;
      const sections = op.source === 'income' ? ['orders', 'salesorders'] : op.source === 'invoice' || op.source === 'request' ? ['requests'] : op.source === 'payroll' ? ['payroll'] : ['money'];
      if (!sections.some(s => sectionOpen(open, s)) || (op.source === 'payroll' && !canSeePayroll(actor))) continue;
      if (visible && op.scopeRequestId && !visible.has(op.scopeRequestId)) continue;
      const canonicalSource = op.invoiceId && op.scopeRequestId ? 'invoice' : op.source;
      if (q.source && (q.source === 'supply' ? !['invoice', 'request'].includes(String(canonicalSource)) : q.source !== canonicalSource)) continue;
      if (q.type && q.type !== op.type) continue;
      const node = op.articleId ? byId.get(op.articleId) : undefined, unassigned = !node || node.type !== op.type;
      if ((articleId === 'none' || Number(q.unassigned) === 1) && !unassigned) continue;
      if (articleIds && (!op.articleId || !articleIds.has(op.articleId))) continue;
      if (orderId && String(orderId) !== op.salesOrderId) continue;
      if (q.costCenter && q.costCenter !== op.costCenterCode) continue;
      if (q.counterpartyId && String(q.counterpartyId) !== op.counterpartyId) continue;
      if (q.counterpartyName && String(q.counterpartyName).trim() !== String(op.counterpartyName || op.counterparty || '').trim()) continue;
      const warnings = [...(op.warnings || [])];
      if (op.articleId && !node) warnings.push('Сохранённая статья удалена или отсутствует в справочнике');
      if (node && node.type !== op.type) warnings.push('Направление сохранённой статьи не совпадает с фактом');
      if (node?.archivedAt) warnings.push('Сохранённая статья в архиве');
      result.push({ ...op, source: canonicalSource, warnings });
    }
    return { ops: result, from, to, today, docs, tree: tree.items, diagnostics: tree.diagnostics, byId, excludedSources, filters: { ...q, from, to, companyId: q.companyId || null } };
  }
  private async present(rows: Op[], context: Awaited<ReturnType<FinancialOperationsReader['filtered']>>, actor?: AuthenticatedUser, detail = false) {
    const ids = [...new Set(rows.map(r => r.salesOrderId).filter(Boolean) as string[])].map(id => oid(id, 'заказа'));
    const orders = ids.length ? await this.connection.db!.collection('salesorders').find({ _id: { $in: ids } }, { projection: { orderNo: 1, productionNo: 1, customer: 1, title: 1 } }).toArray() : [];
    const names = new Map(orders.map(o => [String(o._id), [o.productionNo || o.orderNo, o.customer, o.title].filter(Boolean).join(' · ')]));
    return rows.map(row => {
      const node = row.articleId ? context.byId.get(row.articleId) : undefined;
      const canPrepare = row.source === 'income' && !row.paymentId && actor && canSeeMoney(actor) && (actor.isOwner || effectiveRoles(actor.role).includes('manager'));
      const { classificationOriginal: _original, classificationOverride: _override, classificationEffective: _effective, classificationHistory: _history, ...summary } = row; // eslint-disable-line @typescript-eslint/no-unused-vars
      return { ...summary, id: row.operationId, source: row.source, companyName: row.companyName || row.company, counterpartyName: row.counterpartyName || row.counterparty || null, articlePath: node?.path || (row.articleId ? ['Неизвестная статья ' + row.articleId] : []), costCenter: row.costCenterCode || null, projectName: row.salesOrderId ? names.get(row.salesOrderId) || 'Сохранённый объект' : null,
        ...(canPrepare ? { classificationPreparation: { kind: 'income-payment-identities', sourceId: row.sourceId } } : {}), ...(detail ? { classificationOriginal: row.classificationOriginal, classificationEffective: row.classificationEffective, classificationHistory: row.classificationHistory || [] } : {}) };
    });
  }
  async list(q: Query, actor?: AuthenticatedUser, scope: StockScope | null = null) {
    const context = await this.filtered(q, actor, scope), page = Number(q.page || 1), limit = Number(q.limit || 30);
    if (!Number.isInteger(page) || page < 1 || !Number.isInteger(limit) || limit < 1 || limit > 100) throw new BadRequestException('Страница от1, размер от1 до100');
    const sort = q.sort || 'date', dir = q.dir || 'desc'; if (!['date', 'amount'].includes(String(sort)) || !['asc', 'desc'].includes(String(dir))) throw new BadRequestException('Проверьте сортировку');
    const factor = dir === 'asc' ? 1 : -1;
    const sorted = [...context.ops].sort((a, b) => factor * (sort === 'amount' ? a.amount - b.amount : a.date.localeCompare(b.date)) || a.operationId!.localeCompare(b.operationId!));
    let income = 0, expense = 0; for (const op of sorted) if (op.type === 'income') income += Math.round(op.amount * 100); else expense += Math.round(op.amount * 100);
    return { excludedSources: context.excludedSources, totalsScope: 'accessible-source-facts', items: await this.present(sorted.slice((page - 1) * limit, page * limit), context, actor), total: sorted.length, page, limit, totals: { income: income / 100, expense: expense / 100, net: (income - expense) / 100, currency: 'RUB' }, counts: { unassigned: sorted.filter(r => !r.articleId || !context.byId.has(r.articleId) || context.byId.get(r.articleId)?.type !== r.type).length }, filters: context.filters };
  }
  async detail(operationId: string, actor?: AuthenticatedUser, scope: StockScope | null = null) {
    const target = await this.classifications.locate(operationId); await this.classifications.assertAccess(target, actor, scope);
    const context = await this.filtered({ from: target.date, to: target.date, companyId: target.companyId }, actor, scope);
    const row = context.ops.find(o => o.operationId === target.operationId || o.originOperationId === operationId);
    if (!row) throw new NotFoundException('Активная денежная операция не найдена');
    row.classificationOriginal = originalClassification(target.metadata);
    row.classificationOverride = target.metadata.classificationOverride;
    row.classificationEffective = effectiveClassification(target.metadata);
    row.classificationHistory = target.metadata.classificationHistory || [];
    return (await this.present([row], context, actor, true))[0];
  }
  async replayView(operationId: string, event: { version: number; after: { articleId: string | null; salesOrderId: string | null; costCenter: string | null; costObject: string | null }; original?: Op['classificationOriginal']; override?: Op['classificationOverride'] }, actor?: AuthenticatedUser, scope: StockScope | null = null) {
    const target = await this.classifications.locate(operationId); await this.classifications.assertAccess(target, actor, scope);
    const context = await this.filtered({ from: target.date, to: target.date, companyId: target.companyId }, actor, scope);
    const current = context.ops.find(o => o.operationId === target.operationId); if (!current) throw new NotFoundException('Активная операция не найдена');
    const after = event.after;
    const row: Op = { ...current, articleId: after.articleId || undefined, salesOrderId: after.salesOrderId || undefined, costCenterCode: after.costCenter, costObject: after.costObject, classificationVersion: event.version, classificationOriginal: event.original || originalClassification(target.metadata), classificationOverride: event.override || {}, classificationEffective: after as Op['classificationEffective'], classificationHistory: (target.metadata.classificationHistory || []).filter((h: { version: number }) => h.version <= event.version) };
    return (await this.present([row], context, actor, true))[0];
  }

  async byArticles(q: Query, actor?: AuthenticatedUser, scope: StockScope | null = null) {
    const context = await this.filtered(q, actor, scope);
    const options = await this.finance.articleReportOptions({ ...q, org: q.companyId || q.org, salesOrderId: q.salesOrderId || q.order });
    return { ...buildFinancialArticleReport(context.ops, context.docs, context.from, context.to, context.today, context.diagnostics, options), excludedSources: context.excludedSources, totalsScope: 'accessible-source-facts' };
  }
}
