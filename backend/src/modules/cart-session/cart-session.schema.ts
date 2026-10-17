import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type CartSessionStatus = 'active' | 'converted' | 'expired';
export type CartSessionDocument = HydratedDocument<CartSession>;

@Schema({ collection: 'cart_sessions', timestamps: true })
export class CartSession {
  @Prop({ required: true, unique: true, index: true })
  sessionId!: string;

  @Prop({ required: true, default: () => new Date() })
  createdAt!: Date;

  @Prop()
  expiresAt?: Date;

  @Prop({ type: Types.ObjectId, ref: 'Counterparty' })
  counterpartyId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Organization' })
  organizationId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  userId?: Types.ObjectId;

  @Prop({
    enum: ['active', 'converted', 'expired'],
    default: 'active',
    index: true,
  })
  status!: CartSessionStatus;

  @Prop()
  convertedQuotationId?: string;

  @Prop({ default: true })
  isActive!: boolean;

  /** TZ-CORE-302: soft-delete timestamp; null = active. */
  @Prop({ type: Date, default: null, index: true })
  deletedAt?: Date | null;
}

export const CartSessionSchema = SchemaFactory.createForClass(CartSession);
CartSessionSchema.index({ sessionId: 1, status: 1 });
