import { createHash } from 'crypto';
import { ConflictException, BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import { originalClassification, hasClassificationHistory } from '../../common/financial-classification';
import type { IncomeDto } from './dto';
export type IncomeRecord = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
export const incomeIdentityHash = (source: IncomeRecord) => {
  const metadata = (p: IncomeRecord) => ({ paymentId: p.paymentId || null, companyId: String(p.companyId || ''), articleId: String(p.articleId || ''), classificationVersion: Number(p.classificationVersion || 0), classificationOriginal: p.classificationOriginal || null, classificationOverride: p.classificationOverride || null });
  return createHash('sha256').update(JSON.stringify({ version: Number(source.version || 0), companyId: String(source.companyId || ''), amount: source.amount, paidDate: source.paidDate || null, payments: (source.payments || []).map((p: IncomeRecord) => ({ ...metadata(p), date: p.date, amount: p.amount, method: p.method || '', note: p.note || '' })), legacyPaymentMetadata: source.legacyPaymentMetadata ? metadata(source.legacyPaymentMetadata) : null })).digest('hex');
};
export const temporaryIncomeOperationId = (source: IncomeRecord, index: number) => 'income-unprepared:' + String(source._id || source.id) + ':' + incomeIdentityHash(source) + ':' + index;
/** Старые части не сопоставляются по дате/сумме/индексу; после ID потеря идентичности отклоняется. */
export function protectIncomePaymentWrites(cur: IncomeRecord, fields: IncomeRecord, dto: IncomeDto, opts: { allowRemovedPaymentId?: string; serverNewPaymentId?: string } = {}) {
  const old = (cur.payments || []) as IncomeRecord[], oldById = new Map(old.filter((p) => p.paymentId).map((p) => [String(p.paymentId), p]));
  if (dto.payments !== undefined) {
    if (old.some((p) => !p.paymentId)) throw new ConflictException({ message: 'Сначала подготовьте историю оплат: старые части не имеют устойчивых ID', code: 'PAYMENT_IDENTITIES_REQUIRED' });
    if (cur.legacyPaymentMetadata && !(cur.payments || []).length && cur.paidDate) throw new ConflictException('Синтетическую старую оплату нельзя заменить массивом без отдельной сверки');
    const sent = (dto.payments || []).map((p) => p.paymentId).filter(Boolean) as string[];
    if (new Set(sent).size !== sent.length) throw new BadRequestException('ID платежа повторяется в массиве');
    if (sent.some((id) => !oldById.has(id) && id !== opts.serverNewPaymentId)) throw new BadRequestException('Неизвестный или чужой paymentId');
    if ([...oldById.keys()].some((id) => !sent.includes(id) && id !== opts.allowRemovedPaymentId)) throw new ConflictException('Массив потерял существующие paymentId: перечитайте позицию. Удаление — отдельным действием');
    fields.payments = (fields.payments || []).map((p: IncomeRecord, index: number) => {
      const raw = dto.payments![index], previous = raw.paymentId ? oldById.get(raw.paymentId) : undefined;
      if (previous) {
        if (raw.articleId !== undefined && String(raw.articleId || '') !== String(previous.articleId || '')) throw new ConflictException('Статью принятой оплаты меняйте через классификацию операции');
        if (hasClassificationHistory(previous) && (Number(previous.amount) !== Number(p.amount) || new Date(previous.date).toISOString().slice(0, 10) !== new Date(p.date).toISOString().slice(0, 10))) throw new ConflictException('Классифицированный платёж нельзя заменить обычной правкой источника');
        return { ...previous, ...p, date: new Date(previous.date).toISOString().slice(0, 10) === new Date(p.date).toISOString().slice(0, 10) ? previous.date : p.date, articleId: previous.articleId, companyId: previous.companyId || cur.companyId, classificationOriginal: previous.classificationOriginal || originalClassification({ articleId: previous.articleId || null, salesOrderId: cur.orderId || null }) };
      }
      const articleId = raw.articleId !== undefined ? raw.articleId : ('articleId' in fields ? fields.articleId : cur.articleId);
      return { ...p, paymentId: p.paymentId || new Types.ObjectId().toHexString(), articleId: articleId || null, articleDefaulted: raw.articleId === undefined, companyId: fields.companyId || cur.companyId, classificationOriginal: originalClassification({ articleId: articleId || null, salesOrderId: fields.orderId || cur.orderId || null }) };
    });
  }
  const synthetic = cur.legacyPaymentMetadata;
  if (synthetic && hasClassificationHistory(synthetic) && (('paidDate' in fields && String(fields.paidDate || '') !== String(cur.paidDate || '')) || ['amountManual', 'unitPrice', 'qty'].some((key) => key in fields && fields[key] !== cur[key]))) throw new ConflictException('Классифицированную старую оплату нельзя заменить или снять обычной правкой');
  if ('paidDate' in fields && fields.paidDate && !old.length && !synthetic && !cur.paidDate) fields.legacyPaymentMetadata = { paymentId: new Types.ObjectId().toHexString(), companyId: fields.companyId || cur.companyId, classificationOriginal: originalClassification({ articleId: fields.articleId || cur.articleId || null, salesOrderId: fields.orderId || cur.orderId || null }) };
}
