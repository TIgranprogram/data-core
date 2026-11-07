import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import type { PartRow, StepRow } from '../../common/work-route-rows';

export type OrderLinePlanDocument = HydratedDocument<OrderLinePlan>;

/**
 * План позиции заказа (C041 Э1): свои части и шаги (вид работ × часть), скопированные из изделия и проверенные менеджером.
 * Одна запись на позицию (`incomeId` уникален). Только data-core. Позиция удалена — план остаётся (восстановили — на месте).
 */
@Schema({ timestamps: true, collection: 'orderlineplans' })
export class OrderLinePlan {
  @Prop({ type: Types.ObjectId, required: true }) incomeId!: Types.ObjectId;
  /** Изделие на момент копии; null — изделия у позиции не было. */
  @Prop({ type: Types.ObjectId, default: null }) productId?: Types.ObjectId | null;
  /** product — взято из изделия; manual — изделия нет, план собран вручную. */
  @Prop({ type: String, enum: ['product', 'manual'], default: 'product' }) origin!: 'product' | 'manual';
  /** Версия для защиты от одновременной правки: растёт при каждой записи. */
  @Prop({ type: Number, default: 1 }) rev!: number;
  @Prop({ type: [Object], default: [] }) parts!: PartRow[];
  @Prop({ type: [Object], default: [] }) steps!: StepRow[];
  /** `products.updatedAt` на момент копии (или последнего переноса в изделие) — по нему видно «изделие изменилось». */
  @Prop({ type: Date, default: null }) productRevAtCopy?: Date | null;
  @Prop({ type: Date }) launchedAt?: Date;
  @Prop({ type: Date, default: null }) deletedAt?: Date | null;
}

export const OrderLinePlanSchema = SchemaFactory.createForClass(OrderLinePlan);
OrderLinePlanSchema.index({ incomeId: 1 }, { unique: true });
OrderLinePlanSchema.index({ 'steps.assigneeId': 1 }, { sparse: true }); // Гант: планы человека (C041 Э2)
