import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types, type ClientSession } from 'mongoose';
import { oid } from '../../common/list-query';
import { ourCompanies } from '../incomes/incomes.service';
import { SupplyInvoice, SupplyInvoiceDocument } from './supply-invoice.schema';
import { SupplyRequest, SupplyRequestDocument } from './supply-request.schema';
import { SupplyInvoicePaymentsService } from './supply-invoice-payments.service';
import { RevokeUndatedInvoicePaymentDto, UndatedInvoicePaymentDto } from './dto-invoice';
import { cents, financials, type FinancialRecord as Row } from './invoice-financials';
import { hasUndatedPayment, undatedBasis, undatedHash, undatedLocked } from './undated-payment';
@Injectable()
export class SupplyUndatedPaymentsService {
  constructor(@InjectConnection() private readonly connection: Connection,
    @InjectModel(SupplyInvoice.name) private readonly invoices: Model<SupplyInvoiceDocument>,
    @InjectModel(SupplyRequest.name) private readonly requests: Model<SupplyRequestDocument>,
    private readonly ledger: SupplyInvoicePaymentsService) {}
  private async command(id: string, dto: UndatedInvoicePaymentDto | RevokeUndatedInvoicePaymentDto, action: 'confirm' | 'revoke', actorId?: string) {
    const invoiceId = oid(id, 'счёта'), reason = dto.reason?.trim();
    if (!reason || reason.length < 3 || !dto.clientUid?.trim()) throw new BadRequestException('Укажите основание и ключ команды');
    const hash = undatedHash({ action, reason, fileIds: [...new Set(('fileIds' in dto && dto.fileIds) || [])].sort() });
    const repeat = (inv: Row) => {
      const receipt = (inv.undatedPaymentCommands || []).find((x: Row) => x.clientUid === dto.clientUid);
      if (receipt && receipt.requestHash !== hash) throw new ConflictException('Ключ команды уже использован с другими данными');
      return !!receipt;
    };
    const load = async (session?: ClientSession) => {
      const q = this.invoices.findOne({ _id: invoiceId, deletedAt: null });
      const row = await (session ? q.session(session) : q).lean().exec();
      if (!row) throw new NotFoundException('Счёт не найден');
      return row as Row;
    };
    if (repeat(await load())) return;
    const session = await this.connection.startSession();
    try { await session.withTransaction(async () => {
      const inv = await load(session); if (repeat(inv)) return;
      if (Number(inv.version || 0) !== dto.version) throw new ConflictException('Счёт изменился — перечитайте карточку');
      if ((inv.undatedPaymentCommands || []).length >= 100) throw new ConflictException('Слишком много уточнений — требуется сверка истории');
      let evidence: Row;
      if (action === 'revoke') {
        if (!hasUndatedPayment(inv)) throw new ConflictException('Нет активного подтверждения без даты');
        evidence = { ...inv.undatedPaymentEvidence, state: 'revoked', revokedAt: new Date(), revokedBy: actorId, revokeReason: reason };
      } else {
        if (hasUndatedPayment(inv)) throw undatedLocked();
        if (inv.status !== 'draft' && inv.status !== 'issued') throw new ConflictException('Для этого состояния нужна сверка оплаты');
        const lines = await this.requests.find({ invoiceId, deletedAt: null, status: { $ne: 'cancelled' } }).sort({ _id: 1 }).session(session).lean().exec() as Row[];
        const f = financials(inv, lines);
        const anyPayment = await this.connection.db!.collection('supplyinvoicepayments').findOne({ invoiceId }, { session, projection: { _id: 1 } });
        if (anyPayment || inv.paymentSnapshot || inv.paidAt || Number(inv.paidAmount) > 0 || Number(inv.sourcePaidAmount) > 0 || lines.some(x => x.paid || x.paidAt)) throw new ConflictException('У счёта уже есть история оплаты — требуется сверка');
        if (f.currency !== 'RUB' || !lines.length || !inv.no || !inv.date || !inv.supplierId || lines.some(x => !(Number(x.qty) > 0)) || !(Number(f.sourceAmount) > 0) || f.accountingAmountRub === null || cents(Number(inv.amount)) !== cents(f.sourceAmount!)) throw new BadRequestException('Заполните согласованный рублёвый счёт, номер, дату и суммы строк');
        const payer = (await ourCompanies(this.connection)).find(x => String(x.id) === String(inv.payerCompanyId));
        if (!payer || lines.some(x => String(x.companyId || '') !== String(payer.id))) throw new BadRequestException('Укажите одну нашу компанию для счёта и всех строк');
        const fileIds = [...new Set((dto as UndatedInvoicePaymentDto).fileIds || [])];
        if (fileIds.length && await this.connection.db!.collection('photos').countDocuments({ _id: { $in: fileIds.map(x => oid(x, 'файла')) }, deletedAt: null }, { session }) !== fileIds.length) throw new BadRequestException('Файл подтверждения не найден');
        evidence = { state: 'pending', clientUid: dto.clientUid, requestHash: hash, amountRub: f.accountingAmountRub, sourceAmount: f.sourceAmount, currency: 'RUB', payerCompanyId: inv.payerCompanyId, basisHash: undatedBasis(inv, lines), allocations: await this.ledger.snapshotAllocations(inv, lines, f.accountingAmountRub, new Types.ObjectId(String(payer.id)), session), reason, fileIds: fileIds.map(x => oid(x, 'файла')), confirmedAt: new Date(), confirmedBy: actorId, sourceVersion: dto.version };
      }
      const result = await this.invoices.updateOne({ _id: invoiceId, deletedAt: null, ...(inv.version === undefined ? { version: { $exists: false } } : { version: inv.version }), ...(action === 'confirm' ? { 'undatedPaymentEvidence.state': { $ne: 'pending' } } : { 'undatedPaymentEvidence.state': 'pending' }) }, { $set: { undatedPaymentEvidence: evidence, ...(action === 'confirm' ? { status: 'issued' } : {}) }, $push: { undatedPaymentCommands: { clientUid: dto.clientUid, requestHash: hash, action, at: new Date(), by: actorId, evidence } }, $inc: { version: 1 } }, { session }).exec();
      if (!result.matchedCount) throw new ConflictException('Счёт изменился — перечитайте карточку');
    }); } catch (error) { if (!repeat(await load())) throw error; } finally { await session.endSession(); }
  }
  confirm(id: string, dto: UndatedInvoicePaymentDto, actorId?: string) { return this.command(id, dto, 'confirm', actorId); }
  revoke(id: string, dto: RevokeUndatedInvoicePaymentDto, actorId?: string) { return this.command(id, dto, 'revoke', actorId); }
}
