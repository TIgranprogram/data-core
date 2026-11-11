import { BadRequestException, ConflictException } from '@nestjs/common';
import { Types, type ClientSession, type Connection, type Model } from 'mongoose';
import type { CreateProductPassportDto } from './dto/create-product-passport.dto';
import type { ReadyPassportDto } from './dto/ready-passport.dto';
import type { ProductPassportDocument } from './product-passport.schema';
import { assertOneLive } from './passport-bind';
import { fromIncome } from './passport-queue';
import { assertPdf, storePrintPdf, unlinkPrint } from './passport-print-file';
import { dayUtc } from './passport-rules';
import type { Doc } from './passport-consts';

/** Что готовому паспорту нужно от сервиса паспортов. */
export interface ReadyHost {
  model: Model<ProductPassportDocument>;
  connection: Connection;
  allocate: (set: Doc, date: Date, session?: ClientSession) => Promise<void>;
  assertFree: (set: Doc, selfId?: Types.ObjectId, session?: ClientSession) => Promise<void>;
}

type File = { mimetype?: string; size?: number; buffer?: Buffer; originalname?: string } | undefined;

const oid = (v: string) => new Types.ObjectId(v);
const quoted = (name: unknown) => (String(name ?? '').trim() ? ` «${String(name).trim()}»` : '');

/**
 * C072 / П13: готовый паспорт — файл сделан отдельно. Сразу «выпущен», с номером, фирмой, изделием, заказом и файлом печати.
 * Обязательные поля категории не проверяются (документ готов). Все проверки — до записи; номер не передан — следующий из общего ряда.
 */
export async function createReadyPassport(h: ReadyHost, dto: ReadyPassportDto, file: File, userId?: string): Promise<ProductPassportDocument> {
  const buf = assertPdf(file);
  const db = h.connection.db!;
  const product = await db.collection('products').findOne({ _id: oid(dto.productId), deletedAt: null }, { projection: { name: 1, article: 1 } });
  if (!product) throw new BadRequestException('Изделие не найдено — выберите изделие из списка');
  const org = await db.collection('organizations').findOne({ _id: oid(dto.supplierOrgId), isOurCompany: true, deletedAt: null }, { projection: { name: 1, shortName: 1 } });
  if (!org) throw new BadRequestException('Выберите нашу фирму — эта фирма не из списка наших');
  if (dto.salesOrderId && !(await db.collection('salesorders').findOne({ _id: oid(dto.salesOrderId), deletedAt: null }, { projection: { _id: 1 } }))) {
    throw new BadRequestException('Заказ не найден');
  }
  if (dto.incomeId) {
    const inc = await db.collection('incomes').findOne({ _id: oid(dto.incomeId), deletedAt: null }, { projection: { orderId: 1 } });
    if (!inc) throw new BadRequestException('Позиция заказа не найдена');
    if (dto.salesOrderId && inc.orderId && String(inc.orderId) !== dto.salesOrderId) throw new BadRequestException('Позиция относится к другому заказу');
    await assertOneLive(h.model, dto.incomeId); // 409 «На эту позицию уже есть паспорт № … «название»»
  }
  const want = dto.number ? Number(dto.number) : 0;
  if (dto.number && want < 1) throw new BadRequestException('Номер — целое число больше нуля');
  if (want) await assertNumberFree(h.model, want);

  // заказ, заказчик — как у обычного паспорта с позиции/заказа; фирма уже явная
  const filled = await fromIncome(db, { productId: dto.productId, supplierOrgId: dto.supplierOrgId, ...(dto.salesOrderId ? { salesOrderId: dto.salesOrderId } : {}), ...(dto.incomeId ? { incomeId: dto.incomeId } : {}) } as CreateProductPassportDto);
  const stored = await storePrintPdf(buf, file?.originalname, userId);
  const date = dayUtc();
  try {
    for (let attempt = 0; ; attempt++) {
      const set: Doc = {
        productId: oid(dto.productId), name: String(product.name ?? '') || 'Изделие', ...(product.article ? { article: String(product.article) } : {}),
        supplierOrgId: oid(dto.supplierOrgId), supplier: String(org.shortName || org.name || ''),
        ...(filled.salesOrderId ? { salesOrderId: oid(String(filled.salesOrderId)) } : {}), ...(dto.incomeId ? { incomeId: oid(dto.incomeId) } : {}),
        ...(filled.orderNo ? { orderNo: filled.orderNo } : {}), ...(filled.customerName ? { customerName: filled.customerName } : {}),
        date, status: 'issued', issuedAt: new Date(), revision: 1, source: 'ready-file', printFile: stored, warrantyMonths: 12,
        ...(want ? { passportNumber: String(want), passportNo: want } : {}),
      };
      await h.allocate(set, date);
      await h.assertFree(set);
      try {
        return await h.model.create(set);
      } catch (e) {
        if ((e as { code?: number }).code !== 11000) throw e;
        // гонка: тот же номер занят между проверкой и записью — заданный вручную отказ, выданный сервером — ещё попытка
        if (want || attempt >= 2) throw new ConflictException(want ? `Номер ${want} уже занят другим паспортом` : 'Номер уже занят другим паспортом — повторите добавление');
      }
    }
  } catch (e) {
    await unlinkPrint(stored.path);
    throw e;
  }
}

/** Номер занят, если он есть у любого паспорта, даже удалённого или аннулированного. */
async function assertNumberFree(model: Model<ProductPassportDocument>, n: number): Promise<void> {
  const twin = await model.findOne({ passportNumber: String(n) }).setOptions({ includeSoftDeleted: true }).select('name').lean().exec();
  if (twin) throw new ConflictException(`Номер ${n} уже у паспорта${quoted(twin.name)}`);
}
