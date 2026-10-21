import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { CompositionLine, CompositionLineSchema } from '../catalog/composition-line.schema';

@Schema({ _id: false })
class ModuleDimensionsSchema {
  @Prop() width?: number;
  @Prop() height?: number;
  @Prop() depth?: number;
  @Prop() unit?: string;
}

const ModuleDimensionsSchemaFactory = SchemaFactory.createForClass(ModuleDimensionsSchema);

@Schema({ _id: false })
class ModuleWorkTypeSchema {
  @Prop({ type: Types.ObjectId, ref: 'WorkType', required: true }) workTypeId!: Types.ObjectId;
  @Prop({ default: 0 }) estimatedHours!: number;
  @Prop({ default: 0 }) sortOrder!: number;
  /** Gantt planning days for this module↔workType binding; null/absent falls back to WorkType.days seed. */
  @Prop({ type: Number, default: null }) days?: number | null;
}

const ModuleWorkTypeSchemaFactory = SchemaFactory.createForClass(ModuleWorkTypeSchema);

@Schema({ _id: false })
class OverrideDimensionsSchema {
  @Prop() length?: number;
  @Prop() width?: number;
  @Prop() height?: number;
  @Prop() unit?: string;
}

const OverrideDimensionsSchemaFactory = SchemaFactory.createForClass(OverrideDimensionsSchema);

@Schema({ _id: false })
class ModuleMaterialSchema {
  @Prop({ type: Types.ObjectId, ref: 'Material', required: true }) materialId!: Types.ObjectId;
  @Prop({ default: 1 }) quantity!: number;
  @Prop({ default: 'шт' }) unit!: string;
  @Prop({ default: true }) isPurchased!: boolean;
  @Prop({ type: OverrideDimensionsSchemaFactory }) overrideDimensions?: { length?: number; width?: number; height?: number; unit?: string };
  @Prop({ default: 0 }) sortOrder!: number;
}

const ModuleMaterialSchemaFactory = SchemaFactory.createForClass(ModuleMaterialSchema);

export type ProductModuleDocument = HydratedDocument<ProductModule>;

@Schema({ collection: 'productmodules', timestamps: true })
export class ProductModule {
  @Prop({ required: true }) name!: string;
  /** Required external article; sparse compound index keeps legacy empty rows readable. */
  @Prop({ required: true, trim: true }) article!: string;
  @Prop({ type: Types.ObjectId, index: true, sparse: true }) organizationId?: Types.ObjectId;
  /** TZ-NX-REG-CATEGORY-WIRE-MODULES — required on create; Category.type must be `module`. */
  @Prop({ type: Types.ObjectId, ref: 'Category', index: true }) categoryId?: Types.ObjectId;
  @Prop({ type: ModuleDimensionsSchemaFactory }) dimensions?: { width?: number; height?: number; depth?: number; unit?: string };
  @Prop({ default: 0 }) weight?: number;
  @Prop({ default: 0 }) sortOrder!: number;
  /** TZ-CATALOG-314 archive marker; legacy rows without this field remain active. */
  @Prop({ type: Date, default: null, index: true }) deletedAt?: Date | null;
  /** Canonical catalog photo references; ProductModulePhoto remains available for legacy reads/writes. */
  @Prop({ type: [{ type: Types.ObjectId, ref: 'Photo' }], default: [] }) photoIds!: Types.ObjectId[];
  @Prop({ type: Types.ObjectId, ref: 'Photo' }) mainPhotoId?: Types.ObjectId;
  @Prop({ type: [ModuleWorkTypeSchemaFactory], default: [] }) workTypes!: { workTypeId: Types.ObjectId; estimatedHours: number; sortOrder: number; days?: number | null }[];
  /** Legacy embedded material rows retained for TZ-CATALOG-302 dual-read and TZ-CATALOG-304 migration. */
  @Prop({ type: [ModuleMaterialSchemaFactory], default: [] }) materials!: { materialId: Types.ObjectId; quantity: number; unit: string; isPurchased: boolean; overrideDimensions?: { length?: number; width?: number; height?: number; unit?: string }; sortOrder: number }[];
  /** TZ-CATALOG-302: nested module/material composition. Product lines arrive in TZ-CATALOG-305. */
  @Prop({ type: [CompositionLineSchema], default: [] }) composition!: CompositionLine[];
}

export const ProductModuleSchema = SchemaFactory.createForClass(ProductModule);
ProductModuleSchema.index({ sortOrder: 1 });
ProductModuleSchema.index({ organizationId: 1, article: 1 }, { unique: true, sparse: true });
ProductModuleSchema.index({ deletedAt: 1, sortOrder: 1 });
