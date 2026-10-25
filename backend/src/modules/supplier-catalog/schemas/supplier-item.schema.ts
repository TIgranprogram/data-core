import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type SupplierItemDocument = HydratedDocument<SupplierItem>;

@Schema({ _id: false })
export class PriceThreshold {
  @Prop({ required: true })
  minQty!: number;

  @Prop({ required: true })
  price!: number;
}

const PriceThresholdSchema = SchemaFactory.createForClass(PriceThreshold);

@Schema({ collection: 'supplieritems', timestamps: true })
export class SupplierItem {
  @Prop({ type: Types.ObjectId, ref: 'Organization', required: true, index: true })
  supplierId!: Types.ObjectId;

  @Prop({ required: true })
  vendorArticle!: string;

  @Prop({ required: true })
  name!: string;

  @Prop()
  description?: string;

  @Prop()
  priceRetail?: number;

  @Prop({ type: [PriceThresholdSchema], default: undefined })
  prices?: PriceThreshold[];

  /** Относительные пути /uploads/suppliers/<supplierId>/... — скачиваются при синхронизации. */
  @Prop({ type: [String], default: undefined })
  photoUrls?: string[];

  @Prop()
  sourceUrl?: string;

  @Prop({ type: Map, of: String })
  specs?: Map<string, string>;

  @Prop()
  inStock?: boolean;

  @Prop()
  stockQty?: number;

  @Prop()
  unit?: string;

  @Prop()
  category?: string;

  @Prop({ required: true })
  syncedAt!: Date;

  @Prop({ required: true, default: true, index: true })
  active!: boolean;

  @Prop({ type: Types.ObjectId, ref: 'Organization' })
  organizationId?: Types.ObjectId;

  @Prop({ type: Date, default: null })
  deletedAt?: Date | null;
}

export const SupplierItemSchema = SchemaFactory.createForClass(SupplierItem);

SupplierItemSchema.index(
  { supplierId: 1, vendorArticle: 1, organizationId: 1 },
  { unique: true, sparse: true },
);
SupplierItemSchema.index({ supplierId: 1, active: 1 });
