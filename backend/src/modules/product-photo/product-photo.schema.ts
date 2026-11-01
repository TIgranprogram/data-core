import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type ProductPhotoDocument = HydratedDocument<ProductPhoto>;

@Schema({ collection: 'productphotos', timestamps: true })
export class ProductPhoto {
  @Prop({ type: Types.ObjectId, ref: 'Product', required: true, index: true })
  productId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Photo' })
  photoId?: Types.ObjectId;

  @Prop()
  url?: string;

  @Prop()
  caption?: string;

  @Prop({ default: false, index: true })
  isMain!: boolean;

  @Prop({ default: 0 })
  sortOrder!: number;

  /** Назначение: showcase | passport | drawing. Нет поля = showcase (CRM и витрина читают только их). */
  @Prop({ type: String })
  purpose?: string;

  /** Вид рисунка паспорта (PASSPORT_IMAGE_KINDS) — только при purpose='passport'. */
  @Prop({ type: String })
  kind?: string;

  /** TZ-CORE-302: soft-delete timestamp; null = active. */
  @Prop({ type: Date, default: null, index: true })
  deletedAt?: Date | null;
}

export const ProductPhotoSchema = SchemaFactory.createForClass(ProductPhoto);
ProductPhotoSchema.index({ productId: 1, sortOrder: 1 });
ProductPhotoSchema.index({ productId: 1, purpose: 1, kind: 1 });
