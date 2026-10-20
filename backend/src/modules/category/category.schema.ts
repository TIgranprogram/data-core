import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { optimisticLockPlugin } from '../../common/mongoose';

export type CategoryDocument = HydratedDocument<Category>;

@Schema({ collection: 'categories', timestamps: true })
export class Category {
  @Prop({ required: true, index: true })
  name!: string;

  @Prop({ required: true, index: true })
  slug!: string;

  @Prop({ required: true, enum: ['material', 'product', 'module', 'general'], index: true })
  type!: 'material' | 'product' | 'module' | 'general';

  @Prop({ type: Types.ObjectId, ref: 'Category', index: true })
  parentId?: Types.ObjectId;

  /** Materialized path: "Materials/Metals/Steel". For fast tree queries. */
  @Prop({ index: true })
  fullPath?: string;

  @Prop({ required: true, unique: true })
  skuPrefix!: string; // for SKU auto-generation

  @Prop({ default: 0 })
  sortOrder!: number;

  @Prop({ default: true })
  isActive!: boolean;

  @Prop()
  description?: string;

  /** TZ-CATALOG-314 archive marker; legacy rows without this field remain active. */
  @Prop({ type: Date, default: null, index: true })
  deletedAt?: Date | null;

  /** TZ-240: organization this category belongs to. Null/undefined for system (TZ-seeded shared) records. */
  @Prop({ required: false, sparse: true, index: true })
  organizationId?: Types.ObjectId;

  /** TZ-240: marks the record as system-shared (visible across orgs). Created only via admin/seed. */
  @Prop({ default: false })
  isSystem?: boolean;
}

export const CategorySchema = SchemaFactory.createForClass(Category);
CategorySchema.plugin(optimisticLockPlugin);
CategorySchema.index({ type: 1, slug: 1 }, { unique: true });
CategorySchema.index({ deletedAt: 1, organizationId: 1 });
