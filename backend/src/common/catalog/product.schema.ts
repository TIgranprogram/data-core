import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { optimisticLockPlugin } from '../mongoose';
import { CompositionLine, CompositionLineSchema } from './composition-line.schema';
import type { PdmMeta } from './pdm-meta.dto';

@Schema({ _id: false })
class ProdDimensionsSchema {
  @Prop() length?: number;
  @Prop() width?: number;
  @Prop() height?: number;
  @Prop() unit?: string;
}

const ProdDimensionsSchemaFactory = SchemaFactory.createForClass(ProdDimensionsSchema);

export type ProductDocument = HydratedDocument<Product>;
export type ProductKind = 'good' | 'service' | 'work';
export type ProductStatus = 'new' | 'active' | 'archived' | 'draft';

@Schema({ collection: 'products', timestamps: true })
export class Product {
  /** Optional display name; catalog UIs fall back to the required SKU. */
  @Prop({ index: true }) name?: string;
  /** ДМ.2: полное наименование; «как в заказе» — для заказов и паспортов на заказ (необязательно; CRM не читает). */
  @Prop({ trim: true }) fullName?: string;
  @Prop({ trim: true }) orderName?: string;
  /** New products must carry a trimmed article; sparse keeps legacy rows readable. */
  @Prop({ required: true, trim: true, index: true }) sku!: string;
  @Prop({ required: true, enum: ['good', 'service', 'work'], default: 'good' }) kind!: ProductKind;
  @Prop({ required: true, default: 'шт' }) unit!: string;
  @Prop({ type: Types.ObjectId, ref: 'Category', index: true }) categoryId?: Types.ObjectId;
  @Prop() subcategory?: string;
  @Prop({ enum: ['new', 'active', 'archived', 'draft'], default: 'new' }) status?: ProductStatus;
  @Prop({ default: 0 }) listPrice?: number;
  @Prop({ default: 0 }) basePrice?: number;
  @Prop({ default: 0 }) costPrice?: number;
  @Prop({ default: 30 }) defaultMarkupPercent?: number;
  @Prop({ default: 0 }) stockQty?: number;
  @Prop() description?: string;
  @Prop() notes?: string;
  @Prop({ type: [Types.ObjectId], ref: 'Photo', default: [] }) photoIds!: Types.ObjectId[];
  /** C028: признаки продукции (значения справочника productFacetValues) для паспорта «воронкой». Только data-core; CRM поле не читает; индекс — scripts/ensure-indexes.js. */
  @Prop({ type: [Types.ObjectId], default: undefined }) facetValueIds?: Types.ObjectId[];
  /** WAVE-NX-CATALOG-PHOTOS P2: главное фото (обложка) — обязано быть в photoIds (validate в service). */
  @Prop({ type: Types.ObjectId, ref: 'Photo', default: null }) mainPhotoId?: Types.ObjectId | null;
  @Prop({ type: ProdDimensionsSchemaFactory }) dimensions?: { length?: number; width?: number; height?: number; unit?: string };
  @Prop({ default: 0 }) weightKg?: number;
  @Prop() ralCode?: string;
  @Prop({ default: false }) hasPassport?: boolean;
  @Prop({ default: false }) hasDrawing?: boolean;
  @Prop({ type: Types.ObjectId, ref: 'Product' }) copiedFromProductId?: Types.ObjectId;
  /** Вариант изделия (ВР): основное изделие семейства; пусто — изделие основное. Только data-core, CRM не читает. */
  @Prop({ type: Types.ObjectId, ref: 'Product', index: true, sparse: true }) baseProductId?: Types.ObjectId;

  /** Legacy M:N module links retained for TZ-CATALOG-302 dual-read and TZ-CATALOG-304 migration. */
  @Prop({ type: [Types.ObjectId], ref: 'ProductModule', default: [] })
  productModuleIds!: Types.ObjectId[];

  /** TZ-CATALOG-302: canonical composition write source; product lines arrive in TZ-CATALOG-305. */
  @Prop({ type: [CompositionLineSchema], default: [] })
  composition!: CompositionLine[];

  /** Маршрут изделия (В работе): виды работ по порядку; lineId — часть состава (composition[]._id); partRowId — часть из parts; hours — норма на 1 шт. Необязательно, CRM не читает. */
  @Prop({ type: [{ _id: false, workTypeId: { type: Types.ObjectId, ref: 'WorkType', required: true }, lineId: { type: Types.ObjectId }, note: { type: String }, partRowId: { type: Types.ObjectId }, hours: { type: Number }, checked: { type: Boolean }, checkedBy: { type: Types.ObjectId }, checkedAt: { type: Date } }], default: undefined })
  workTypes?: Array<{ workTypeId: Types.ObjectId; lineId?: Types.ObjectId; note?: string; partRowId?: Types.ObjectId; hours?: number; checked?: boolean; checkedBy?: Types.ObjectId; checkedAt?: Date }>;

  /** Части изделия для работ (стойки, навес, наполнение; C041). Необязательно, CRM не читает; partId — справочник productParts. */
  @Prop({ type: [{ partId: { type: Types.ObjectId }, name: { type: String, required: true }, qty: { type: Number, default: 1 }, lineId: { type: Types.ObjectId }, checked: { type: Boolean, default: false }, checkedBy: { type: Types.ObjectId }, checkedAt: { type: Date } }], default: undefined })
  parts?: Array<{ _id: Types.ObjectId; partId?: Types.ObjectId; name: string; qty: number; lineId?: Types.ObjectId; checked: boolean; checkedBy?: Types.ObjectId; checkedAt?: Date }>;

  @Prop({ default: true }) isActive!: boolean;
  /** TZ-CATALOG-314 archive marker; legacy rows without this field remain active. */
  @Prop({ type: Date, default: null, index: true }) deletedAt?: Date | null;
  @Prop() purpose?: string;
  @Prop() installation?: string;
  @Prop({ required: false, sparse: true, index: true }) organizationId?: Types.ObjectId;
  @Prop({ default: false }) isSystem?: boolean;
  /** C057: откуда загружено из PDM (версия файла). Без default — CRM-документы поле не получают. */
  @Prop({ type: Object, required: false }) pdm?: PdmMeta;
  /** C057: название ещё не вписано (name = обозначение) — «Требуют заполнения». */
  @Prop({ type: Boolean, required: false }) needsName?: boolean;
}

export const ProductSchema = SchemaFactory.createForClass(Product);
ProductSchema.plugin(optimisticLockPlugin);
ProductSchema.index({ status: 1, isActive: 1 });
ProductSchema.index({ organizationId: 1, sku: 1 }, { unique: true, sparse: true });
ProductSchema.index({ deletedAt: 1, organizationId: 1 });
