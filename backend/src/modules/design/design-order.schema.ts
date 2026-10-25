import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type DesignOrderDocument = HydratedDocument<DesignOrder>;

/**
 * Метка «заказ взят на доску проектирования» (только data-core; в `salesorders` — общей с CRM — поля нет).
 * Одна запись на заказ (unique `orderId`, индекс БЕЗ `deletedAt`): «убрать» ставит `deletedAt`, повторное добавление
 * снимает его upsert-ом (с `includeSoftDeleted`), иначе упало бы на 11000.
 */
@Schema({ collection: 'designorders' })
export class DesignOrder {
  @Prop({ type: Types.ObjectId, required: true }) orderId!: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'User' }) addedBy?: Types.ObjectId;
  @Prop({ type: Date }) addedAt?: Date;
  @Prop({ type: Date, default: null }) deletedAt?: Date | null;
}

export const DesignOrderSchema = SchemaFactory.createForClass(DesignOrder);
DesignOrderSchema.index({ orderId: 1 }, { unique: true });
