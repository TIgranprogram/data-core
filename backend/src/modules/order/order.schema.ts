import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

/** TZ-COMBINE-402 / COUPLING-MAP §2b — колонка Комбайна (SoT lane). */
export type BoardLane = 'prep' | 'design' | 'shop' | 'to_ship' | 'shipped';

@Schema({ _id: false })
export class OrderItem {
  /**
   * TZ-COMBINE-402 — стабильный ключ линии (не index).
   * Required after create/backfill; legacy docs get `legacy-{index}-{orderId}` on read.
   */
  @Prop({ required: true })
  lineId!: string;

  /**
   * TZ-COMBINE-402 — колонка Комбайна. Default `prep` on create.
   * Write path: PATCH .../lines/:lineId/lane (TZ-COMBINE-403). Do not write `shipped` via PATCH.
   */
  @Prop({
    enum: ['prep', 'design', 'shop', 'to_ship', 'shipped'],
    default: 'prep',
  })
  boardLane!: BoardLane;

  @Prop({ type: Types.ObjectId, ref: 'Product', required: true })
  productId!: Types.ObjectId;

  @Prop()
  productName?: string;

  @Prop()
  productSku?: string;

  @Prop({ required: true, default: 0 })
  quantity!: number;

  @Prop()
  unit?: string;

  @Prop({ required: true, default: 0 })
  unitPrice!: number;

  @Prop({ required: true, default: 0 })
  total!: number;

  /** TZ-ORDERS-303 D18: ответственный за изделие в заказе. */
  @Prop({ type: Types.ObjectId, ref: 'User' })
  ownerUserId?: Types.ObjectId;

  /** TZ-ORDERS-303 D16: плановая дата отгрузки позиции. */
  @Prop()
  plannedShipDate?: Date;

  /** TZ-ORDERS-304 D8: line-level readiness gate. */
  @Prop({ default: false })
  readyForWork!: boolean;

  @Prop({ type: Date })
  readyAt?: Date;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  readyByUserId?: Types.ObjectId;

  /**
   * TZ-DASHBOARD-400: ход изделия (legacy kanban).
   * TZ-COMBINE-402+: derived from `boardLane` in TZ-COMBINE-403 — do not treat as SoT lane.
   * Mapping: prep|design→pending, shop→in_production, to_ship→ready, shipped→shipped.
   */
  @Prop({
    enum: ['pending', 'in_production', 'ready', 'shipped'],
    default: 'pending',
  })
  status!: 'pending' | 'in_production' | 'ready' | 'shipped';
}

const OrderItemSchema = SchemaFactory.createForClass(OrderItem);

/**
 * TZ-COMBINE-406 — разреженная полоса модуля изделия на Комбайне.
 * Ключ: (lineId, moduleId). Запись существует только для модуля, который
 * сдвинут отдельно от линии; линия без записей наследует boardLane.
 */
@Schema({ _id: false })
export class ModuleLane {
  @Prop({ required: true })
  lineId!: string;

  @Prop({ type: Types.ObjectId, ref: 'ProductModule', required: true })
  moduleId!: Types.ObjectId;

  @Prop({
    enum: ['prep', 'design', 'shop', 'to_ship', 'shipped'],
    required: true,
  })
  lane!: BoardLane;
}

const ModuleLaneSchema = SchemaFactory.createForClass(ModuleLane);

/**
 * TZ-PRODUCTION-309 — per-order Gantt duration override (not WorkType catalog).
 * Composite key: (orderItemIndex, moduleId, workTypeId).
 */
@Schema({ _id: false })
export class EstimateDayOverride {
  @Prop({ required: true, min: 0 })
  orderItemIndex!: number;

  @Prop({ type: Types.ObjectId, ref: 'ProductModule', required: true })
  moduleId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'WorkType', required: true })
  workTypeId!: Types.ObjectId;

  /** Calendar days ≥ 1 for this order line / module / work type. */
  @Prop({ required: true, min: 1 })
  days!: number;
}

const EstimateDayOverrideSchema = SchemaFactory.createForClass(EstimateDayOverride);

/**
 * TZ-PRODUCTION-316 — per-bar start offset from order visualAnchor (parallel Gantt).
 * Composite key: (orderItemIndex, moduleId, workTypeId).
 */
@Schema({ _id: false })
export class EstimateStartOffset {
  @Prop({ required: true, min: 0 })
  orderItemIndex!: number;

  @Prop({ type: Types.ObjectId, ref: 'ProductModule', required: true })
  moduleId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'WorkType', required: true })
  workTypeId!: Types.ObjectId;

  /** Calendar days ≥ 0 from order visualAnchor (plannedDate ?? date ?? today). */
  @Prop({ required: true, min: 0 })
  offsetDays!: number;
}

const EstimateStartOffsetSchema = SchemaFactory.createForClass(EstimateStartOffset);

/**
 * TZ-NX-GANTT-G14 — per-order work assignment override (job assignment, not skills).
 * Composite key: (orderItemIndex, moduleId, workTypeId).
 * Does not mutate `Worker.workTypeIds` (skills stay the catalog of "who can").
 */
@Schema({ _id: false })
export class EstimateWorkerOverride {
  @Prop({ required: true, min: 0 })
  orderItemIndex!: number;

  @Prop({ type: Types.ObjectId, ref: 'ProductModule', required: true })
  moduleId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'WorkType', required: true })
  workTypeId!: Types.ObjectId;

  /** Empty array = «Не назначен» on the Gantt (no auto-fill from skills). */
  @Prop({ type: [Types.ObjectId], ref: 'Worker', default: [] })
  workerIds!: Types.ObjectId[];
}

const EstimateWorkerOverrideSchema = SchemaFactory.createForClass(EstimateWorkerOverride);

export type OrderStatus = 'draft' | 'confirmed' | 'in_production' | 'ready' | 'shipped' | 'delivered' | 'cancelled';
export type OrderPriority = 'low' | 'normal' | 'high' | 'urgent';
/** TZD-ORDER-IMPORT-01: провенанс заказа — вручную в вебе или через Excel/MCP импорт. */
export type OrderSource = 'manual' | 'desktop-import';
export type OrderDocument = HydratedDocument<Order>;

@Schema({ collection: 'orders', timestamps: true })
export class Order {
  @Prop({ required: true, unique: true, index: true })
  number!: string;

  @Prop({ type: Types.ObjectId, ref: 'Counterparty', required: true, index: true })
  counterpartyId!: Types.ObjectId;

  /** TZ-ORDERS-303 D20: площадка/объект заказчика. */
  @Prop({ type: Types.ObjectId, ref: 'Site', required: true, index: true })
  siteId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Quotation', index: true })
  quotationId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Contract', index: true })
  contractId?: Types.ObjectId;

  @Prop({ required: true, default: () => new Date() })
  date!: Date;

  @Prop()
  plannedDate?: Date;

  @Prop({ type: Types.ObjectId, ref: 'EntityStatus' })
  statusId?: Types.ObjectId;

  @Prop({
    enum: ['draft', 'confirmed', 'in_production', 'ready', 'shipped', 'delivered', 'cancelled'],
    default: 'draft',
    index: true,
  })
  status!: OrderStatus;

  @Prop({ required: true, default: 0 })
  total!: number;

  /** S31: payment fact belongs to the order, independently of quotationId. */
  @Prop({ default: false, index: true })
  isPaid!: boolean;

  @Prop({ type: Date, default: null })
  paidAt?: Date | null;

  @Prop()
  notes?: string;


  /** TZ-ORDERS-305 D19: source of materials for the order. */
  @Prop({ enum: ['own', 'customer'], default: 'own', index: true })
  materialsSource!: 'own' | 'customer';

  /** TZD-ORDER-IMPORT-01: провенанс — кто/что создало заказ. */
  @Prop({ enum: ['manual', 'desktop-import'], default: 'manual', index: true })
  source!: OrderSource;

  @Prop({ default: true, index: true })
  isActive!: boolean;

  @Prop({ type: [OrderItemSchema], default: [] })
  items!: OrderItem[];

  /** TZ-COMBINE-406 — полосы модулей (sparse: только явно сдвинутые модули). */
  @Prop({ type: [ModuleLaneSchema], default: [] })
  moduleLanes!: ModuleLane[];

  @Prop()
  deliveryAddress?: string;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  managerId?: Types.ObjectId;

  @Prop({ enum: ['low', 'normal', 'high', 'urgent'], default: 'normal', index: true })
  priority!: OrderPriority;

  @Prop({ type: [Types.ObjectId], ref: 'Shipment', default: [] })
  shipmentIds!: Types.ObjectId[];

  @Prop({ type: [Types.ObjectId], ref: 'Reservation', default: [] })
  reservationIds!: Types.ObjectId[];

  /** TZ-PRODUCTION-309: order-level estimate days (Gantt); catalog WorkType.days is fallback. */
  @Prop({ type: [EstimateDayOverrideSchema], default: [] })
  estimateDayOverrides!: EstimateDayOverride[];

  /** TZ-PRODUCTION-316: per-bar start offset from visualAnchor (parallel OK). */
  @Prop({ type: [EstimateStartOffsetSchema], default: [] })
  estimateStartOffsets!: EstimateStartOffset[];

  /**
   * TZ-NX-GANTT-G14: job assignment override (who does this work on THIS order).
   * Separate from `Worker.workTypeIds` (skills = "who can"). Empty/absent → «Не назначен».
   */
  @Prop({ type: [EstimateWorkerOverrideSchema], default: [] })
  estimateWorkerOverrides!: EstimateWorkerOverride[];

  /**
   * TZ-ORDERS-308: soft-delete marker. Was written by `remove()` before this TZ
   * without a schema field, so strict mode silently dropped it.
   */
  @Prop({ type: Date, default: null, index: true })
  deletedAt?: Date | null;

  /** TZ-ORDERS-307: какая наша фирма (Organization) исполняет заказ. */
  @Prop({ type: Types.ObjectId, ref: 'Organization', index: true })
  organizationId?: Types.ObjectId;
}

export const OrderSchema = SchemaFactory.createForClass(Order);
OrderSchema.index({ counterpartyId: 1, date: -1 });
OrderSchema.index({ siteId: 1, date: -1 });
OrderSchema.index({ status: 1, date: -1 });
OrderSchema.index({ managerId: 1, status: 1 });
