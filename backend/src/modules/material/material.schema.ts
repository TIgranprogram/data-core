import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { optimisticLockPlugin } from '../../common/mongoose';
import { CompositionLine, CompositionLineSchema } from '../catalog/composition-line.schema';

export type MaterialDocument = HydratedDocument<Material>;

export const MATERIAL_KINDS = ['raw', 'part', 'fastener', 'purchased', 'other'] as const;
export type MaterialKind = (typeof MATERIAL_KINDS)[number];

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

  /** TZ-CATALOG-314 archive marker; legacy rows without this field remain active. */
  @Prop({ type: Date, default: null, index: true })
  deletedAt?: Date | null;

  @Prop({ required: false, sparse: true, index: true })
  organizationId?: Types.ObjectId;

  @Prop({ default: false })
  isSystem?: boolean;
}

export const MaterialSchema = SchemaFactory.createForClass(Material);
MaterialSchema.plugin(optimisticLockPlugin);
MaterialSchema.index({ supplierId: 1 });
MaterialSchema.index({ organizationId: 1, article: 1 }, { unique: true, sparse: true });
MaterialSchema.index({ deletedAt: 1, organizationId: 1 });
