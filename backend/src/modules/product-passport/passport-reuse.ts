import type { ClientSession, Model } from 'mongoose';
import type { ProductPassportDocument } from './product-passport.schema';
import { escapeRe, isDraftNumber, type Doc } from './passport-consts';

/**
 * C060: одно изделие в одной позиции договора — один номер. Выпуск паспорта позиции (`incomeId`) + изделия (`productId`), у которой
 * уже есть аннулированный паспорт с номером, берёт его номер, номер изделия и талон — счётчик не расходуется.
 * Уникальные индексы не дают двум паспортам один номер, поэтому у аннулированного номер переписывается в `<№>~<k>`, а прежние значения
 * остаются в `annulledNumbers` (аннулированный паспорт и его история на месте).
 */
export const REUSE_MARK = '~';

/** Номера для нового паспорта вместо счётчика; нет подходящего аннулированного паспорта — null. Вызывать внутри транзакции выпуска. */
export async function takeOverNumbers(model: Model<ProductPassportDocument>, draft: Doc, session?: ClientSession): Promise<Doc | null> {
  if (!draft.incomeId || !draft.productId) return null;
  const q = model.find({ incomeId: draft.incomeId, productId: draft.productId, status: 'annulled' }).setOptions({ includeSoftDeleted: true }).sort({ annulledAt: -1 }).limit(10);
  if (session) q.session(session);
  const prev = ((await q.lean().exec()) as unknown as Doc[]).find((d) => d.passportNumber && !isDraftNumber(d.passportNumber) && !String(d.passportNumber).includes(REUSE_MARK));
  if (!prev) return null;
  const no = String(prev.passportNumber);
  const cq = model.countDocuments({ passportNumber: new RegExp(`^${escapeRe(no)}${REUSE_MARK}`) }).setOptions({ includeSoftDeleted: true });
  if (session) cq.session(session);
  const k = (await cq.exec()) + 1;
  const kept = { passportNumber: no, productCode: prev.productCode ?? null, warrantyCode: prev.warrantyCode ?? null };
  const uq = model.updateOne({ _id: prev._id }, { $set: { passportNumber: `${no}${REUSE_MARK}${k}`, annulledNumbers: kept }, $unset: { productCode: '', warrantyCode: '' } }).setOptions({ includeSoftDeleted: true });
  if (session) uq.session(session);
  await uq.exec();
  const out: Doc = { passportNumber: no, passportNo: Number(no) || undefined };
  if (prev.productCode) out.productCode = prev.productCode;
  if (prev.warrantyCode) out.warrantyCode = prev.warrantyCode;
  return out;
}
