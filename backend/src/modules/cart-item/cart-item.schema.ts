import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type CartItemStatus = 'active' | 'converted' | 'removed';
export type CartItemDocument = HydratedDocument<CartItem>;

@Schema({ collection: 'cart_items', timestamps: true })
export class CartItem {
  @Prop({ required: true, index: true })
  sessionId!: string;

  @Prop({ type: Types.ObjectId, ref: 'Product', required: true, index: true })
  productId!: Types.ObjectId;

  @Prop()
  productName?: string;

  @Prop({ required: true, default: 1 })
  quantity!: number;

  @Prop()
  unit?: string;

  @Prop({ required: true, default: 0 })
  priceSnapshot!: number;

  @Prop({ default: 0 })
  markupPercent!: number;

  @Prop()
  notes?: string;

  @Prop({
    enum: ['active', 'converted', 'removed'],
    default: 'active',
    index: true,
  })
  status!: CartItemStatus;

  @Prop({ default: false, index: true })
  isConverted!: boolean;

  @Prop()
  convertedQuotationId?: string;

  /** TZ-CORE-302: soft-delete timestamp; null = active. */
  @Prop({ type: Date, default: null, index: true })
  deletedAt?: Date | null;
}

export const CartItemSchema = SchemaFactory.createForClass(CartItem);
CartItemSchema.index({ sessionId: 1, productId: 1 });
CartItemSchema.index({ sessionId: 1, status: 1 });
