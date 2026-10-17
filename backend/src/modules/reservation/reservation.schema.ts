import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type ReservationStatus = 'active' | 'released' | 'fulfilled' | 'cancelled';
export type ReservationDocument = HydratedDocument<Reservation>;

@Schema({ collection: 'reservations', timestamps: true })
export class Reservation {
  @Prop({ required: true, index: true })
  orderId!: string;

  /** Exactly one of productId/materialId is required (enforced in ReservationService, mirrors StorageItem). */
  @Prop({ type: Types.ObjectId, ref: 'Product', index: true })
  productId?: Types.ObjectId;

  /** TZ-NX-SUPPLY-S0: kit-reserve holds materials, not finished products. */
  @Prop({ type: Types.ObjectId, ref: 'Material', index: true })
  materialId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Warehouse', required: true, index: true })
  warehouseId!: Types.ObjectId;

  /** TZ-NX-SUPPLY-S0: which order line this kit-reserve materialized for (traceability for S1/S2). */
  @Prop({ min: 0 })
  orderItemIndex?: number;

  @Prop({ required: true, default: 0 })
  qty!: number;

  @Prop({ default: true, index: true })
  isActive!: boolean;

  @Prop({ enum: ['active', 'released', 'fulfilled', 'cancelled'], default: 'active', index: true })
  status!: ReservationStatus;

  @Prop()
  zoneName?: string;

  @Prop()
  notes?: string;

  @Prop()
  expiresAt?: Date;

  /** TZ-CORE-302: soft-delete timestamp; null = active. */
  @Prop({ type: Date, default: null, index: true })
  deletedAt?: Date | null;
}

export const ReservationSchema = SchemaFactory.createForClass(Reservation);
ReservationSchema.index({ orderId: 1, status: 1 });
