import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type InventorFileDocument = HydratedDocument<InventorFile>;

@Schema({ collection: 'inventorfiles', timestamps: true })
export class InventorFile {
  @Prop({ type: Types.ObjectId, ref: 'Product', required: true, index: true })
  productId!: Types.ObjectId;

  @Prop()
  productName?: string;

  @Prop()
  productSku?: string;

  @Prop({ required: true })
  fileName!: string;

  @Prop()
  fileType?: string;

  @Prop({ default: 0 })
  sizeKb?: number;

  @Prop({ default: 1 })
  version!: number;

  @Prop()
  author?: string;

  @Prop({ required: true })
  url!: string;

  @Prop()
  description?: string;

  @Prop()
  notes?: string;

  /** TZ-CORE-302: soft-delete timestamp; null = active. */
  @Prop({ type: Date, default: null, index: true })
  deletedAt?: Date | null;
}

export const InventorFileSchema = SchemaFactory.createForClass(InventorFile);
InventorFileSchema.index({ productId: 1, version: -1 });
