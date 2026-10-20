import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type ProductPassportDocument = HydratedDocument<ProductPassport>;

@Schema({ collection: 'productpassports', timestamps: true })
export class ProductPassport {
  @Prop({ type: Types.ObjectId, ref: 'Product', required: true, unique: true, index: true })
  productId!: Types.ObjectId;

  @Prop({ required: true })
  passportNumber!: string;

  @Prop()
  productCode?: string;

  @Prop()
  warrantyCode?: string;

  @Prop()
  date?: Date;

  @Prop()
  name?: string;

  @Prop()
  category?: string;

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

  @Prop()
  description?: string;

  @Prop()
  installationSite?: string;

  @Prop()
  supplier?: string;

  @Prop()
  photo?: string;

  @Prop({ default: true })
  isActive!: boolean;

  /** TZ-CORE-302: soft-delete timestamp; null = active. */
  @Prop({ type: Date, default: null, index: true })
  deletedAt?: Date | null;
}

export const ProductPassportSchema = SchemaFactory.createForClass(ProductPassport);
