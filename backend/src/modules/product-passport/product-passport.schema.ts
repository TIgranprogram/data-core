import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type ProductPassportDocument = HydratedDocument<ProductPassport>;

/** Виды картинок паспорта (TASKS ПС.1): общий вид — титул; габариты — прил. 1; зона и монтаж — прил. 2. */
export const PASSPORT_IMAGE_KINDS = ['overview', 'dimensions', 'safety', 'mounting'] as const;
export type PassportImageKind = (typeof PASSPORT_IMAGE_KINDS)[number];

@Schema({ _id: false })
export class PassportImage {
  @Prop({ required: true, enum: PASSPORT_IMAGE_KINDS })
  kind!: PassportImageKind;

  @Prop({ type: Types.ObjectId, ref: 'Photo', required: true })
  photoId!: Types.ObjectId;

  @Prop({ default: 0 })
  order!: number;

  /** Подпись под картинкой («Вид спереди», «Рисунок 3 разрез»). */
  @Prop()
  caption?: string;
}
const PassportImageSchema = SchemaFactory.createForClass(PassportImage);

/** Строка комплектности (Приложение 3); по умолчанию — «Изделие в сборе». */
@Schema({ _id: false })
export class PassportBomLine {
  @Prop() pos?: number;
  @Prop() code?: string;
  @Prop() name?: string;
  @Prop() qty?: number;
  @Prop() unit?: string;
  @Prop() note?: string;
}
const PassportBomLineSchema = SchemaFactory.createForClass(PassportBomLine);

/**
 * Паспорт изделия = ЭКЗЕМПЛЯР (номер, талон, номер изделия, дата, заказчик/объект); модель — отдельно
 * (`productId` — ссылка на каталог, необязательна и не уникальна). Коллекция общая с kppdf: поля только
 * добавляются (TASKS ПС.1, T21). Выданные номера/талоны/даты не меняются молча.
 */
@Schema({ collection: 'productpassports', timestamps: true })
export class ProductPassport {
  /** Модель из каталога («Продукция»), если найдена. Было: required + unique (1 паспорт на изделие) — снято в ПС.1. */
  @Prop({ type: Types.ObjectId, ref: 'Product', index: true })
  productId?: Types.ObjectId;

  @Prop({ required: true })
  passportNumber!: string;

  /** Числовой № паспорта — для сортировки и счётчика (`passportNumber` — строка, как у kppdf). */
  @Prop({ index: true })
  passportNo?: number;

  /** Номер изделия (серийный). Уникален, кроме помеченных дублей (`productCodeDuplicate`). */
  @Prop()
  productCode?: string;

  /** Выданный до переноса дубль номера изделия (2491 у №461–463) — оставлен, помечен (решение пользователя 2026-10-21). */
  @Prop({ default: false })
  productCodeDuplicate!: boolean;

  /** Гарантийный талон: ГГГГМ-№ (месяц без нуля), из даты и № паспорта. */
  @Prop()
  warrantyCode?: string;

  @Prop()
  date?: Date;

  @Prop()
  name?: string;

  @Prop()
  category?: string;

  /** Артикул модели как есть текстом (7_31, 3_4_2). */
  @Prop()
  article?: string;

  @Prop()
  height?: number;

  @Prop()
  length?: number;

  @Prop()
  width?: number;

  @Prop()
  weight?: number;

  /** Описание (раздел 1.1) — собирается из частей (наименование, материалы, установка, назначение), правится вручную. */
  @Prop()
  description?: string;

  /** Устаревшее поле kppdf («место установки») — не удаляется; новое — `installationMethod` / `objectName`. */
  @Prop()
  installationSite?: string;

  /** Поставщик текстом (как в таблице); связь — `supplierOrgId`. */
  @Prop()
  supplier?: string;

  /** Устаревшее одно фото kppdf — не удаляется; новое — `images[]`. */
  @Prop()
  photo?: string;

  @Prop()
  materials?: string;

  @Prop()
  purpose?: string;

  @Prop()
  installationMethod?: string;

  /** Объект / адрес установки. */
  @Prop()
  objectName?: string;

  @Prop()
  customerName?: string;

  @Prop({ type: Types.ObjectId, ref: 'Organization' })
  customerOrgId?: Types.ObjectId;

  @Prop()
  orderNo?: string;

  @Prop({ type: Types.ObjectId, ref: 'SalesOrder' })
  salesOrderId?: Types.ObjectId;

  /** Наша компания-поставщик (реквизиты, печать и подпись для PDF). */
  @Prop({ type: Types.ObjectId, ref: 'Organization', index: true })
  supplierOrgId?: Types.ObjectId;

  @Prop({ default: 12 })
  warrantyMonths!: number;

  @Prop({ type: [PassportImageSchema], default: [] })
  images!: PassportImage[];

  @Prop({ type: [PassportBomLineSchema], default: undefined })
  bom?: PassportBomLine[];

  /** Когда последний раз скачали PDF. */
  @Prop()
  pdfIssuedAt?: Date;

  /** Откуда запись: 'sheet:Pasports' (перенос), 'app' (создан в приложении). */
  @Prop()
  source?: string;

  @Prop({ default: true })
  isActive!: boolean;

  /** TZ-CORE-302: soft-delete timestamp; null = active. */
  @Prop({ type: Date, default: null, index: true })
  deletedAt?: Date | null;
}

export const ProductPassportSchema = SchemaFactory.createForClass(ProductPassport);
// Уникальность (ПС.1). Частичные индексы: старые записи kppdf без новых полей не мешают; дубль 2491 — вне индекса.
ProductPassportSchema.index({ passportNumber: 1 }, { unique: true, name: 'passportNumber_unique' });
ProductPassportSchema.index({ productCode: 1 }, { unique: true, name: 'productCode_unique', partialFilterExpression: { productCodeDuplicate: { $eq: false }, productCode: { $type: 'string' } } });
ProductPassportSchema.index({ warrantyCode: 1 }, { unique: true, name: 'warrantyCode_unique', partialFilterExpression: { warrantyCode: { $type: 'string' } } });
