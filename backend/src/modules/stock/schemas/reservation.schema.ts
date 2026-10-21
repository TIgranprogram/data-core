/**
 * ОБЩАЯ КОЛЛЕКЦИЯ единой базы: копия схемы из CRM kppdf (D:kppdf-8.0ackend/src/modules/reservation/reservation.schema.ts).
 * Менять только синхронно в обоих репозиториях (docs/UNIFY-SUPPLY-WAREHOUSE.md).
 */
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

  // ── Общие поля единой базы (data-core ↔ kppdf), добавлены 2026-10-18 ──
  /** Ключ записи, созданной клиентом (приложение «Склад · Снабжение», офлайн-очередь) — защита от дублей при повторной отправке. */
  @Prop({ index: true, sparse: true })
  clientUid?: string;

  /** Синхронизация Google-таблиц (data-core sheets-sync): откуда строка и её отпечаток. */
  @Prop({ index: true, sparse: true })
  sheetSource?: string;

  @Prop()
  sheetKey?: string;

  @Prop()
  syncHash?: string;

  /** TZ-CORE-302: soft-delete timestamp; null = active. */
  @Prop({ type: Date, default: null, index: true })
  deletedAt?: Date | null;

  // ── Поля только data-core (2026-10-21, «Бронь по списку»): kppdf их не пишет ──
  /** Общий ключ брони одного списка (снимается целиком). */
  @Prop({ type: Types.ObjectId, index: true, sparse: true })
  batchId?: Types.ObjectId;

  /** Название брони: для чего (конструкция / изделие). */
  @Prop()
  groupName?: string;

  /** Под заказ заказчика (salesorders). */
  @Prop({ type: Types.ObjectId })
  salesOrderId?: Types.ObjectId;

  /** Кто поставил бронь (users). */
  @Prop({ type: Types.ObjectId })
  createdBy?: Types.ObjectId;

  /** Сколько уже выдано по брони (TASKS Б.2): qty — остаток брони, у выданной целиком (fulfilled) qty = выдано. */
  @Prop({ default: 0 })
  issuedQty?: number;
}

export const ReservationSchema = SchemaFactory.createForClass(Reservation);
ReservationSchema.index({ orderId: 1, status: 1 });
