import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { type Connection, type Model, Types } from 'mongoose';
import { Income, type IncomeDocument, incomePayments } from './income.schema';
import { oid } from '../../common/list-query';
import { versionFilter } from '../../common/versioned';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { originalClassification } from '../../common/financial-classification';
import { incomeIdentityHash, temporaryIncomeOperationId } from './income-payment-identities';
import { MaterializeIncomePaymentsDto } from './dto';
@Injectable()
export class IncomePaymentIdentitiesService {
  constructor(@InjectConnection() private readonly connection: Connection, @InjectModel(Income.name) private readonly model: Model<IncomeDocument>) {}
  private async load(id: string) { const row = await this.model.findOne({ _id: oid(id, 'дохода'), deletedAt: null }).lean().exec(); if (!row) throw new NotFoundException('Доход не найден'); return row; }
  async plan(id: string) {
    const cur = await this.load(id), payments = incomePayments(cur), synthetic = !cur.payments?.length && !!cur.paidDate;
    const blockers: string[] = [];
    if (payments.length && (!cur.companyId || !await this.connection.db!.collection('organizations').findOne({ _id: cur.companyId, isOurCompany: true, deletedAt: null }))) blockers.push('Компания оплаты не определена источником: нужна сверка без догадки о плательщике');
    const items = payments.map((p, index) => ({ oldOperationId: p.paymentId ? 'income:' + id + ':' + p.paymentId : temporaryIncomeOperationId(cur, index), date: new Date(p.date).toISOString().slice(0, 10), amount: p.amount, method: p.method || null, hasIdentity: !!p.paymentId }));
    const changesCount = items.filter((p) => !p.hasIdentity).length;
    return { version: Number(cur.version || 0), planHash: incomeIdentityHash(cur), items, changesCount, totals: { count: items.length, amount: Math.round(items.reduce((sum, p) => sum + p.amount, 0) * 100) / 100, currency: 'RUB' }, synthetic, canApply: changesCount > 0 && !blockers.length, blockers };
  }
  async materialize(id: string, dto: MaterializeIncomePaymentsDto, actor?: AuthenticatedUser) {
    const first = await this.load(id), prior = first.paymentIdentityReceipts?.find((r) => r.clientUid === dto.clientUid);
    if (prior) { if (prior.planHash !== dto.planHash) throw new ConflictException('Ключ подготовки уже использован с другим планом'); return { identityMapping: prior.identityMapping, repeated: true }; }
    if (dto.confirm !== true) return { ...(await this.plan(id)), dryRun: true };
    if (dto.version === undefined || !dto.clientUid || !dto.planHash) throw new BadRequestException('Для подготовки подтвердите версию, план и ключ повтора');
    const plan = await this.plan(id);
    if (plan.version !== dto.version || plan.planHash !== dto.planHash) throw new ConflictException('Источник изменился: перечитайте план');
    if (plan.blockers.length) throw new ConflictException(plan.blockers[0]);
    if (!plan.canApply) throw new ConflictException('История уже подготовлена или не содержит оплат');
    const session = await this.connection.startSession(); const mapping: Record<string, string> = {};
    try { await session.withTransaction(async () => {
      const cur = await this.model.findOne({ _id: first._id, deletedAt: null }).session(session).lean().exec();
      if (!cur) throw new NotFoundException('Доход не найден');
      const repeated = cur.paymentIdentityReceipts?.find((r) => r.clientUid === dto.clientUid);
      if (repeated) { if (repeated.planHash !== dto.planHash) throw new ConflictException('Ключ использован с другим планом'); Object.assign(mapping, repeated.identityMapping); return; }
      if (Number(cur.version || 0) !== dto.version || incomeIdentityHash(cur) !== dto.planHash) throw new ConflictException('Источник изменился: перечитайте план');
      const payments = incomePayments(cur).map((p, index) => {
        const paymentId = p.paymentId || new Types.ObjectId().toHexString();
        mapping[p.paymentId ? 'income:' + id + ':' + p.paymentId : temporaryIncomeOperationId(cur, index)] = 'income:' + id + ':' + paymentId;
        return { ...p, paymentId, companyId: p.companyId || cur.companyId, classificationOriginal: p.classificationOriginal || originalClassification({ articleId: p.articleId || null, salesOrderId: cur.orderId || null }) };
      });
      const set = cur.payments?.length ? { payments } : payments.length ? { legacyPaymentMetadata: { paymentId: payments[0].paymentId, companyId: payments[0].companyId, classificationOriginal: payments[0].classificationOriginal } } : {};
      const receipt = { clientUid: dto.clientUid, planHash: dto.planHash, identityMapping: { ...mapping } };
      const changed = await this.model.updateOne({ _id: cur._id, ...versionFilter(dto.version) }, { $set: set, $inc: { version: 1 }, $push: { paymentIdentityReceipts: receipt } }, { session }).exec();
      if (!changed.matchedCount) throw new ConflictException('Источник изменился: перечитайте план');
      await this.connection.db!.collection('auditlogs').insertOne({ action: 'income.payment-identities.materialized', entityType: 'Income', entityId: cur._id, userId: actor?.id ? oid(actor.id, 'автора') : undefined, userName: actor?.username, createdAt: new Date(), details: { before: { version: dto.version, planHash: dto.planHash }, after: { version: dto.version! + 1, identityMapping: mapping }, meta: { metadataOnly: true, totals: plan.totals } } }, { session });
    }); } finally { await session.endSession(); }
    return { identityMapping: mapping, materialized: true };
  }
}
