import { BadRequestException, ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { Types, type ClientSession, type Connection, type Model } from 'mongoose';
import type { CreateProductPassportDto } from './dto/create-product-passport.dto';
import type { ProductPassportDocument } from './product-passport.schema';
import { isDraftNumber, type Doc } from './passport-consts';
import { addressFromOrder, fromIncome, ourSupplierId } from './passport-queue';

type Db = NonNullable<Connection['db']>;
export const lineScopeKey = (id: unknown) => 'line/' + String(id).toLowerCase();
export const isScopeDuplicate = (error: unknown) => {
  const e = error as { code?: number; keyPattern?: Record<string, number>; message?: string };
  return e?.code === 11000 && (!!e.keyPattern?.creationScopeKey || !!e.message?.includes('creationScopeKey_1'));
};

export async function assertScopeIndex(db: Db) {
  const indexes = await db.collection('productpassports').indexes().catch((e: { code?: number }) => {
    if (e.code === 26) return [];
    throw e;
  });
  if (!indexes.some((i) => i.name === 'creationScopeKey_1' && i.key.creationScopeKey === 1 && i.unique && i.sparse)) {
    throw new ServiceUnavailableException('Новый выпуск пока недоступен: не установлен индекс паспортов');
  }
}

function sourceId(raw: unknown, label: string): Types.ObjectId {
  if (!Types.ObjectId.isValid(String(raw ?? ''))) throw new BadRequestException(`Укажите ${label}`);
  return new Types.ObjectId(String(raw));
}

/** Для версии 1 связи и принадлежность берём только из живых записей. */
export async function bindPresentation(db: Db, input: Doc, session?: ClientSession): Promise<Doc> {
  const productId = sourceId(input.productId, 'изделие');
  const options = { session };
  const product = await db.collection('products').findOne({ _id: productId, deletedAt: null }, { ...options, projection: { _id: 1 } });
  if (!product) throw new BadRequestException('Изделие не найдено');
  let supplierId = input.supplierOrgId ? sourceId(input.supplierOrgId, 'фирму') : null;
  let scope: Doc = {};
  let orderFirm = false;
  if (input.incomeId) {
    const incomeId = sourceId(input.incomeId, 'позицию заказа');
    const salesOrderId = sourceId(input.salesOrderId, 'заказ');
    const inc = await db.collection('incomes').findOne({ _id: incomeId, deletedAt: null }, options);
    if (!inc) throw new BadRequestException('Позиция заказа не найдена');
    if (inc.cancelledAt) throw new BadRequestException('Позиция заказа отменена');
    if (String(inc.orderId) !== String(salesOrderId) || String(inc.productId) !== String(productId)) {
      throw new ConflictException('Позиция относится к другому заказу или изделию — перечитайте книжку');
    }
    const order = await db.collection('salesorders').findOne({ _id: salesOrderId, deletedAt: null }, options);
    if (!order || order.stage === 'cancelled' || order.cancelledAt) throw new BadRequestException('Заказ не найден или отменён');
    if (order.companyId) {
      orderFirm = true;
      const company = sourceId(order.companyId, 'фирму заказа');
      if (supplierId && !supplierId.equals(company)) throw new ConflictException('Фирма паспорта отличается от фирмы заказа — перечитайте книжку');
      supplierId = company;
    }
    if (!supplierId) {
      const ours = await db.collection('organizations').find({ isOurCompany: true, deletedAt: null }, { ...options, projection: { _id: 1 } }).limit(2).toArray();
      if (ours.length === 1) supplierId = ours[0]._id;
    }
    scope = {
      incomeId, salesOrderId,
      orderNo: order.orderNo || order.productionNo || null,
      customerName: order.customer || null,
      customerOrgId: order.customerOrgId || null,
      objectName: input.objectName || await addressFromOrder(db, order) || null,
      ...(inc.title ? { name: String(inc.title) } : {}),
    };
  } else if (input.salesOrderId || input.orderNo || input.customerOrgId || input.customerName) {
    throw new BadRequestException('Для самостоятельного паспорта заказ и покупатель не задаются');
  }
  if (!supplierId) throw new BadRequestException('Выберите нашу фирму');
  const org = await db.collection('organizations').findOne({ _id: supplierId, isOurCompany: true, deletedAt: null }, options);
  if (!org) {
    if (orderFirm) throw new ConflictException('В заказе указана удалённая или чужая фирма');
    throw new BadRequestException('Выберите действующую нашу фирму');
  }
  return { ...scope, productId, supplierOrgId: supplierId, supplier: String(org.shortName || org.name || '') };
}

/**
 * Фирма (`supplierOrgId`): явная → companyId заказа (наша) → одна наша;
 * несколько наших и не из чего взять — 400 «Выберите фирму»; ноль — черновик без фирмы.
 * Черновик с позицией/заказом — `fromIncome` (C062/C063).
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
  const found = model.findOne(q).select('passportNumber name');
  if (session) found.session(session);
  const twin = await found.lean().exec();
  if (!twin) return;
  const no = twin.passportNumber && !isDraftNumber(twin.passportNumber) ? ` № ${twin.passportNumber}` : '';
  const title = String(twin.name ?? '').trim();
  throw new ConflictException(`На эту позицию уже есть паспорт${no}${title ? ` «${title}»` : ''}`);
}
