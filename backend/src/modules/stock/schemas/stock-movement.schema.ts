/**
 * ОБЩАЯ КОЛЛЕКЦИЯ единой базы: копия схемы из CRM kppdf (D:kppdf-8.0ackend/src/modules/stock-movement/stock-movement.schema.ts).
 * Менять только синхронно в обоих репозиториях (docs/UNIFY-SUPPLY-WAREHOUSE.md).
 */
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type StockMovementType = 'in' | 'out' | 'transfer' | 'adjust';
export type StockMovementDocument = HydratedDocument<StockMovement>;

@Schema({ collection: 'stockmovements', timestamps: true })
export class StockMovement {
  @Prop({ required: true, enum: ['in', 'out', 'transfer', 'adjust'], index: true })
  type!: StockMovementType;

  @Prop({ required: true, default: () => new Date(), index: true })
  date!: Date;

  /** Exactly one of productId/materialId is required by StockMovementService. */
  @Prop({ type: Types.ObjectId, ref: 'Product', index: true })
  productId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Material', index: true })
  materialId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Warehouse', required: true, index: true })
  warehouseId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Warehouse', index: true })
  toWarehouseId?: Types.ObjectId;

  @Prop() zoneName?: string;
  @Prop() toZoneName?: string;
  @Prop({ required: true }) qty!: number;
  @Prop({ default: 0 }) cost?: number;
  @Prop() orderId?: string;
  @Prop() documentRef?: string;
  @Prop({ type: Types.ObjectId, ref: 'User' }) createdBy?: Types.ObjectId;

  /** Примечание / основание движения (приложение «Склад · Снабжение», журнал из таблицы). */
  @Prop({ trim: true })
  notes?: string;

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

  // ── Поля только data-core (2026-10-19): kppdf их не пишет и при чтении не использует ──
  /** Изменение остатка со знаком (+ приход, − расход); у adjust qty хранится по модулю, знак — здесь. */
  @Prop()
  delta?: number;

  /** Движение отменено (обратным движением `cancelOf`). */
  @Prop({ type: Date })
  cancelledAt?: Date;

  /** Это движение — отмена движения с этим id. */
  @Prop({ type: Types.ObjectId })
  cancelOf?: Types.ObjectId;

  /** Пакет операций (экран «Операции»: списание/приход/пересчёт нескольких позиций разом) — отменяется целиком. */
  @Prop({ type: Types.ObjectId, index: true, sparse: true })
  batchId?: Types.ObjectId;

  /** Откуда запись: 'google-sheets' — история из таблицы (остаток по ней не менялся). */
  @Prop()
  source?: string;

  /** Заказ заказчика data-core (`salesorders`) и его позиция (`incomes`) — поле только data-core; `orderId` занят CRM. */
  @Prop({ type: Types.ObjectId, index: true, sparse: true })
  salesOrderId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId })
  salesOrderLineId?: Types.ObjectId;

  // ── Выдача со склада (data-core, 2026-10-21, TASKS Б.2 / Л.3) ──
  /** Выдано по брони (reservations) — «Выдать по брони». */
  @Prop({ type: Types.ObjectId, index: true, sparse: true })
  reservationId?: Types.ObjectId;

  /** Кому выдано: сотрудник (persons). */
  @Prop({ type: Types.ObjectId, index: true, sparse: true })
  issuedToPersonId?: Types.ObjectId;

  /** Кому / куда выдано текстом: объект, бригада (если не сотрудник). */
  @Prop({ trim: true })
  issuedTo?: string;

  /**
   * Подтверждение получения вторым человеком (TASKS Б.4, решение пользователя 2026-10-21): выдача с получателем —
   * pending («кладовщик выдал»), подтвердил получатель — confirmed («мастер получил»). Поля только data-core.
   */
  @Prop({ index: true, sparse: true })
  receipt?: 'pending' | 'confirmed';

  @Prop({ type: Types.ObjectId })
  receivedBy?: Types.ObjectId;

  @Prop({ type: Date })
  receivedAt?: Date;

  /** Остаток до и после движения (ФИ.5: в журнале «931 → 0», а не только «−931»). */
  @Prop()
  qtyBefore?: number;

  @Prop()
  qtyAfter?: number;

  /** TZ-CORE-302: soft-delete timestamp; null = active. */
  @Prop({ type: Date, default: null, index: true })
  deletedAt?: Date | null;
}

export const StockMovementSchema = SchemaFactory.createForClass(StockMovement);
StockMovementSchema.index({ warehouseId: 1, date: -1 });
StockMovementSchema.index({ productId: 1, date: -1 });
StockMovementSchema.index({ materialId: 1, date: -1 });
