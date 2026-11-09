import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { optimisticLockPlugin } from '../../common/mongoose';
import { CompositionLine, CompositionLineSchema } from '../../common/catalog/composition-line.schema';
import type { PdmMeta } from '../../common/catalog/pdm-meta.dto';

export type MaterialDocument = HydratedDocument<Material>;

export const MATERIAL_KINDS = ['raw', 'part', 'fastener', 'purchased', 'other'] as const;
export type MaterialKind = (typeof MATERIAL_KINDS)[number];
export const DIM_SOURCES = ['dxf', 'pdm', 'manual'] as const;
export type DimSource = (typeof DIM_SOURCES)[number];

/** One measured material dimension; values use the project-wide millimetre convention. */
@Schema({ _id: false })
export class Dimension {
  @Prop({
    required: true,
    enum: ['length', 'width', 'height', 'thickness', 'diameter', 'depth'],
  })
  type!: 'length' | 'width' | 'height' | 'thickness' | 'diameter' | 'depth';

  @Prop({ required: true, min: 0 })
  value!: number;

  @Prop({ default: false })
  isImmutable!: boolean;
}

export const DimensionSchema = SchemaFactory.createForClass(Dimension);

@Schema({ collection: 'materials', timestamps: true })
export class Material {
  @Prop({ required: true, index: true })
  name!: string;

  /** ДМ.2: полное наименование (необязательно; CRM не читает). */
  @Prop({ trim: true })
  fullName?: string;

  /** ДМ.2: наименование «как в счёте» поставщика (необязательно; CRM не читает). */
  @Prop({ trim: true })
  invoiceName?: string;

  /** New materials require a trimmed external article; legacy empty rows remain readable. */
  @Prop({ required: true, trim: true })
  article!: string;

  /** Classification of the catalog leaf; legacy rows are backfilled to `other`. */
  @Prop({ type: String, enum: MATERIAL_KINDS, index: true, required: false })
  materialKind?: MaterialKind | null;

  @Prop({ index: true, sparse: true })
  assortment?: string;

  @Prop({ index: true, sparse: true })
  standardRef?: string;

  @Prop({ index: true, sparse: true })
  materialGrade?: string;

  /**
   * C043: ручной тип позиции («Соединитель», «Труба»…) — переопределяет тип, вычисленный из названия.
   * Поле только data-core: CRM его не читает, схема kppdf не меняется (Mongo без схемы, поле необязательное).
   */
  @Prop({ trim: true })
  typeName?: string;

  /** Труба: мытая / не мытая (СМ.5); поле только data-core, CRM его не читает. */
  @Prop({ type: Boolean, default: undefined })
  washed?: boolean;

  @Prop({ type: Number, min: 0 })
  weightKg?: number;

  @Prop({ unique: true, sparse: true, index: true })
  sku?: string;

  @Prop({ required: true })
  unit!: string;

  @Prop({ type: Types.ObjectId, ref: 'Category', index: true })
  categoryId?: Types.ObjectId;

  @Prop()
  description?: string;

  @Prop({ default: 0 })
  pricePerUnit?: number;

  /** Последняя закупочная цена за ед. без НДС (пишет materialprices при записи строки, не пересчёт). */
  @Prop() lastPrice?: number;
  @Prop({ type: Date }) lastPriceDate?: Date;
  @Prop({ type: Types.ObjectId, ref: 'Organization' }) lastSupplierId?: Types.ObjectId;
  @Prop() lastSupplierName?: string;

  @Prop({ default: 0 })
  stockQty?: number;

  @Prop({ type: [DimensionSchema], default: [] })
  dimensions!: Dimension[];

  /**
   * TZ-SUPPLY-305 — цвета, в которых материал можно заказать (свободный список).
   * Строка быстрого заказа выбирает одно из этих значений (`SupplyRequest.color`).
   * Дедупликация — на сервисе/UI; unique индекс не нужен.
   */
  @Prop({ type: [String], default: [] })
  colors?: string[];

  @Prop({ type: [{ type: Types.ObjectId, ref: 'Photo' }], default: [] })
  photoIds!: Types.ObjectId[];

  @Prop({ type: Types.ObjectId, ref: 'Photo' })
  mainPhotoId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Organization' })
  supplierId?: Types.ObjectId;

  @Prop()
  notes?: string;

  /**
   * TZ-NX-DETAIL-MATERIAL-BOM: a Деталь (materialKind='part') BOM of raw
   * materials. Only ever populated for part-kind rows; raw materials never
   * get their own nested composition (they are always a composition leaf).
   */
  @Prop({ type: [CompositionLineSchema], default: [] })
  composition?: CompositionLine[];

  // ── Общие поля единой базы (data-core ↔ kppdf), добавлены 2026-10-18 ──
  /** Синхронизация Google-таблиц (data-core sheets-sync): откуда позиция и её отпечаток. */
  @Prop({ index: true, sparse: true })
  sheetSource?: string;

  @Prop()
  sheetKey?: string;

  @Prop()
  syncHash?: string;

  /**
   * МЦ-2: связь «позиция склада → материал паспорта» — поле только data-core, CRM не читает.
   * Без default и required (иначе CRM-документы получат поле при каждом сохранении). Пишется только
   * `PATCH /materials/:id/passport-spec`. Тексты (МЦ-6) — в том же поддереве.
   */
  @Prop({ type: Object, required: false })
  passportSpec?: { materialId?: Types.ObjectId; sizes?: string[]; isCoating?: boolean; passportText?: string; techText?: string };

  /** TZ-CATALOG-314 archive marker; legacy rows without this field remain active. */
  @Prop({ type: Date, default: null, index: true })
  deletedAt?: Date | null;

  @Prop({ required: false, sparse: true, index: true })
  organizationId?: Types.ObjectId;

  @Prop({ default: false })
  isSystem?: boolean;

  // ── C057 «Загрузка из PDM»: только data-core, CRM поля не читает. Без default — CRM-документы их не получают. ──
  /** Обозначение PDM в одном написании (метизы, покупные). Уникально в организации среди заполненных. */
  @Prop({ type: String, required: false, trim: true })
  pdmCode?: string;

  /** Другие написания обозначения (Number, кириллица). */
  @Prop({ type: [String], default: undefined })
  pdmAliases?: string[];

  /** Откуда загружено и какая версия (детали). */
  @Prop({ type: Object, required: false })
  pdm?: PdmMeta;

  /** Откуда размеры детали: развёртка DXF, карточка PDM, вручную. */
  @Prop({ type: String, enum: DIM_SOURCES, required: false })
  dimSource?: DimSource;

  /** Сортамент (сырьё без формата): детали ссылаются на него, склад и снабжение его скрывают. */
  @Prop({ type: Boolean, required: false })
  isProfile?: boolean;

  /** Складской формат → его сортамент. */
  @Prop({ type: Types.ObjectId, ref: 'Material', required: false })
  profileId?: Types.ObjectId;

  /** Основной формат сортамента (для «что купить» и цены м²/м). */
  @Prop({ type: Boolean, required: false })
  isDefaultFormat?: boolean;

  /** Коэффициент отходов сортамента (≥ 1). */
  @Prop({ type: Number, min: 1, required: false })
  scrapFactor?: number;

  /** Название не вписано (name = обозначение) — «Требуют заполнения». */
  @Prop({ type: Boolean, required: false })
  needsName?: boolean;
}

export const MaterialSchema = SchemaFactory.createForClass(Material);
MaterialSchema.plugin(optimisticLockPlugin);
MaterialSchema.index({ supplierId: 1 });
MaterialSchema.index({ 'passportSpec.materialId': 1 }, { sparse: true });
MaterialSchema.index({ organizationId: 1, article: 1 }, { unique: true, sparse: true });
MaterialSchema.index({ deletedAt: 1, organizationId: 1 });
// C057: partialFilterExpression, а не sparse — на составном ключе sparse не отсеивает документы без pdmCode (organizationId есть почти у всех)
MaterialSchema.index({ organizationId: 1, pdmCode: 1 }, { unique: true, partialFilterExpression: { pdmCode: { $type: 'string' } } });
MaterialSchema.index({ organizationId: 1, pdmAliases: 1 }, { partialFilterExpression: { pdmAliases: { $type: 'string' } } });
MaterialSchema.index({ profileId: 1 }, { sparse: true });
