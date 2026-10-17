import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type SupplyTaskStatus = 'draft' | 'confirmed' | 'ordered' | 'received';
export type SupplyTaskDocument = HydratedDocument<SupplyTask>;

/**
 * TZ-SUPPLY-301 — задача снабжения (потребность по линии заказа).
 * D9/D18: confirmCanOrder = confirmedBy + confirmedAt (зелёный флаг).
 */
@Schema({ collection: 'supplytasks', timestamps: true })
export class SupplyTask {
  @Prop({ type: Types.ObjectId, ref: 'Order', required: true, index: true })
  orderId!: Types.ObjectId;

  /** TZ-SUPPLY-312 — owning organization; new writes are always scoped. */
  @Prop({ type: Types.ObjectId, ref: 'Organization', required: false, index: true })
  organizationId?: Types.ObjectId;

  /** Идентификатор линии заказа (productId или индекс как строка) — P0 без subdoc _id. */
  @Prop({ trim: true })
  orderLineId?: string;

  @Prop({ type: Types.ObjectId, ref: 'Material', index: true })
  materialId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'ProductModule', index: true })
  moduleId?: Types.ObjectId;

  @Prop({ required: true, default: 1, min: 0 })
  qty!: number;

  @Prop({
    enum: ['draft', 'confirmed', 'ordered', 'received'],
    default: 'draft',
    index: true,
  })
  status!: SupplyTaskStatus;

  /** D18: кто подтвердил «можно заказывать». */
  @Prop({ type: Types.ObjectId, ref: 'User', index: true })
  confirmedBy?: Types.ObjectId;

  @Prop({ type: Date })
  confirmedAt?: Date;

  @Prop({ trim: true })
  notes?: string;

  /** Подпись для UI без join (best-effort). */
  @Prop({ trim: true })
  title?: string;

  @Prop({ type: Date, default: null, index: true })
  deletedAt?: Date | null;
}

export const SupplyTaskSchema = SchemaFactory.createForClass(SupplyTask);SupplyTaskSchema.index({ organizationId: 1, orderId: 1, materialId: 1 },
  {
    name: 'supplytasks_open_order_material_unique',
    unique: true,
    partialFilterExpression: {
      materialId: { $exists: true },
      deletedAt: null,
      status: { $in: ['draft', 'confirmed', 'ordered'] },
    },
  },
);
SupplyTaskSchema.index({ organizationId: 1, orderId: 1, status: 1 });
SupplyTaskSchema.index({ organizationId: 1, status: 1, createdAt: -1 });
