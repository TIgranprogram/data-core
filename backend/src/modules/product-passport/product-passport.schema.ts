import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import type { StoredSpec } from '../../common/catalog/materials-table';

export type ProductPassportDocument = HydratedDocument<ProductPassport>;

/** Виды картинок паспорта (TASKS ПС.1): общий вид — титул; габариты — прил. 1; зона и монтаж — прил. 2. */
/** Виды картинок. Первые четыре — как было (v1); остальные — паспорт v2 (БЗ-6, §3.6): выноски элементов, табличка,
 *  зона безопасности/приземления, фундамент, разметка скважин, сборка, картинка строки комплектности. */
export const PASSPORT_IMAGE_KINDS = ['overview', 'dimensions', 'safety', 'mounting', 'overview_callouts', 'nameplate', 'safety_zone', 'foundation', 'holes', 'assembly', 'bom_item'] as const;
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

  /** v2: для `bom_item` — обозначение строки комплектности (`bom[].code`), к которой картинка. */
  @Prop()
  refCode?: string;
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
  /** v2 (БЗ-6 §3.4): размер, масса, картинка детали. */
  @Prop() size?: string;
  @Prop() mass?: number;
  @Prop({ type: Types.ObjectId, ref: 'Photo' }) photoId?: Types.ObjectId;
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

  /** Номер паспорта. НМ (2026-10-23): выдаётся только при выпуске — у черновика пусто. */
  @Prop()
  passportNumber?: string;

  // ───── НМ: черновик → выпуск → (аннулирование); поля только data-core, kppdf их не читает ─────
  /** draft — черновик без номера; issued — выпущен (номер, талон, текст заморожены); annulled — аннулирован (номер занят). Нет поля — старый паспорт = выпущен. */
  @Prop() status?: string;
  @Prop() issuedAt?: Date;
  @Prop() annulledAt?: Date;
  @Prop({ trim: true }) annulReason?: string;
  /** Редакция выпущенного паспорта (1, 2…); прежние — в revisions. */
  @Prop() revision?: number;
  @Prop({ type: [Object], default: undefined }) revisions?: Array<Record<string, unknown>>;
  /** ТЭ: поля текста, изменённые вручную для этого паспорта (не из справочника) — видно в списке. */
  @Prop({ type: [String], default: undefined }) manualText?: string[];

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

  /** Заметки — лист «Для заметок» в PDF (нет заметки — нет листа; 2026-10-22). Поле только data-core, kppdf его не читает. */
  @Prop({ trim: true })
  note?: string;

  // ───── ПП (2026-10-23): «заполняется после печати» — в PDF значение или линия для ручки; выпуск не блокируют ─────
  @Prop() saleDate?: Date;
  @Prop({ trim: true }) installedBy?: string;
  @Prop() installedAt?: Date;
  /** Строгий выпуск: паспорт создан после ПП — PDF только когда заполнено обязательное (старые паспорта — без флага, как раньше). */
  @Prop() strict?: boolean;

  // ───── Паспорт v2 (БЗ-6, docs/PASSPORTS-V2.md §3.4) — только новые необязательные поля; kppdf их не читает ─────
  /** Код категории паспорта (справочник `passportCategories`): DIO, DSP, TRN, WRK, MAF. Пусто — паспорт v1. */
  @Prop() passportCategory?: string;
  /** Функциональные элементы, материалы — id записей справочников (`dict_values`). Строковое `materials` (v1) не трогаем. */
  @Prop({ type: [Types.ObjectId], default: undefined }) elements?: Types.ObjectId[];
  @Prop({ type: [Types.ObjectId], default: undefined }) materialIds?: Types.ObjectId[];
  /** МИ: таблица «Материалы изделия» { rows: [{ materialId, sizes[], partIds[] }], coatingIds[] } — снимок `products.materialsSpec` с правкой (common/catalog/materials-table.ts). */
  @Prop({ type: Object, default: undefined }) materialsSpec?: StoredSpec | null;
  @Prop({ type: Types.ObjectId }) installationTypeId?: Types.ObjectId;
  /** Разборное — поставляется на сборку (тогда нужна схема сборки). */
  @Prop() isKit?: boolean;
  /** Схемы узлов (Э9.5): 'standard' — из способа установки, где своих нет (по умолчанию); 'own' — только свои. */
  @Prop() schemeSource?: string;
  @Prop() ageFrom?: number;
  @Prop() ageTo?: number;
  @Prop() heightMin?: number;
  @Prop() heightMax?: number;
  @Prop() weightMax?: number;
  @Prop() maxUsers?: number;
  @Prop() fallHeight?: number;
  @Prop() siteLength?: number;
  @Prop() siteWidth?: number;
  @Prop() serviceLifeYears?: number;
  /** Сертификат / декларация: номер, срок, знак ЕАС. Без номера раздел «идентификационные сведения» и ЕАС не печатаются. */
  @Prop({ type: Object }) certificate?: { number?: string; until?: string; hasEac?: boolean };
  /** Изготовитель, если не совпадает с поставщиком. */
  @Prop({ type: Types.ObjectId }) manufacturerOrgId?: Types.ObjectId;
  /** Снимок собранного текста на момент выдачи: правка справочника не меняет выданный паспорт. */
  @Prop({ type: Object }) textSnapshot?: { templateVersion?: number; ownVersion?: number | null; category?: string; at?: Date; sections?: unknown[]; missing?: string[] };

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
