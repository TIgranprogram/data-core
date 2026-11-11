import { BadRequestException, ConflictException } from '@nestjs/common';
import { Types, type ClientSession, type Connection, type Model } from 'mongoose';
import type { CreateProductPassportDto } from './dto/create-product-passport.dto';
import type { ProductPassportDocument } from './product-passport.schema';
import { isDraftNumber } from './passport-consts';
import { fromIncome, ourSupplierId } from './passport-queue';

type Db = NonNullable<Connection['db']>;

/**
 * C062: фирма (`supplierOrgId`) — ровно одна наша подставить; несколько — 400 «Выберите фирму»;
 * ноль — черновик без фирмы (выпуск всё равно просит поставщика).
 * Изделие воронка шлёт сама; API без изделия оставляем (legacy/e2e и «новое изделие» по позиции).
 * Черновик заказа берёт поля у позиции (`fromIncome`).
 */
export async function bindDraft(db: Db, dto: CreateProductPassportDto): Promise<CreateProductPassportDto> {
  const filled = await fromIncome(db, dto);
  if (!filled.supplierOrgId) {
    const n = await db.collection('organizations').countDocuments({ isOurCompany: true, deletedAt: null });
    if (n > 1) throw new BadRequestException('Выберите фирму');
    if (n === 1) {
      const only = await ourSupplierId(db);
      if (only) filled.supplierOrgId = String(only);
    }
  }
  return filled;
}

/**
 * C062: один живой паспорт на позицию заказа. Живой — не аннулирован;
 * корзина скрыта плагином soft-delete. Уникального индекса на `incomeId` нет.
 */
export async function assertOneLive(model: Model<ProductPassportDocument>, incomeId: unknown, exceptId?: Types.ObjectId, session?: ClientSession): Promise<void> {
  const id = incomeId instanceof Types.ObjectId ? incomeId : (Types.ObjectId.isValid(String(incomeId ?? '')) ? new Types.ObjectId(String(incomeId)) : null);
  if (!id) return;
  const q: Record<string, unknown> = { incomeId: id, status: { $ne: 'annulled' } };
  if (exceptId) q._id = { $ne: exceptId };
  const found = model.findOne(q).select('passportNumber');
  if (session) found.session(session);
  const twin = await found.lean().exec();
  if (!twin) return;
  const no = twin.passportNumber && !isDraftNumber(twin.passportNumber) ? ` № ${twin.passportNumber}` : '';
  throw new ConflictException(`На эту позицию уже есть паспорт${no}`);
}
