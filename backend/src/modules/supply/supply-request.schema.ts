import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type SupplyRequestStatus =
  | 'in_progress'
  | 'requested'
  | 'ordered'
  | 'received'
  | 'cancelled';

export type SupplyRequestPriority = 'urgent' | 'normal' | 'low';

export type SupplyRequestDocument = HydratedDocument<SupplyRequest>;

/**
 * TZ-SUPPLY-305 — строка быстрого заказа снабжения.
 *
 * Отдельная коллекция от `SupplyTask` (реестр): `SupplyTask.orderId` required,
 * а быстрый заказ может существовать без привязки к заказу. Справочники
 * (категория/материал/поставщик/контакт/наша компания) — ObjectId ref'ы на
 * уже существующие сущности; статья/цвет/ссылку храним snapshot'ом строки.
 *
 * Статусы и приоритет — строковый enum (канон sibling-модуля SupplyTask), не
 * EntityStatus: статусы фиксированы и совпадают с UI-моком 304/309.
 */
@Schema({ collection: 'supplyrequests', timestamps: true })
export class SupplyRequest {
  /** Свободное наименование — обязательно, когда нет materialId. */
  @Prop({ trim: true })
  title?: string;

  @Prop({ type: Types.ObjectId, ref: 'Category', index: true })
  categoryId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Material', index: true })
  materialId?: Types.ObjectId;

  /** Snapshot артикула материала (без повторного join в списке). */
  @Prop({ trim: true })
  article?: string;

  /** Выбранный цвет строки — одно из значений `Material.colors`. */
  @Prop({ trim: true })
  color?: string;

  @Prop({ trim: true })
  productUrl?: string;

  @Prop({ type: Types.ObjectId, ref: 'Organization', index: true })
  supplierId?: Types.ObjectId;

  /** TZ-SUPPLY-312 — owning organization; new writes are always scoped. */
  @Prop({ type: Types.ObjectId, ref: 'Organization', required: false, index: true })
  organizationId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'OrganizationContact', index: true })
  supplierContactId?: Types.ObjectId;

  /** Наша компания / юрлицо-покупатель. */
  @Prop({ type: Types.ObjectId, ref: 'Organization' })
  companyId?: Types.ObjectId;

  /** Кто просил (участок/отдел) — v1 свободный текст. */
  @Prop({ trim: true })
  requestedBy?: string;

  @Prop({ type: Types.ObjectId, ref: 'Order', index: true })
  orderId?: Types.ObjectId;

  /** Free-text «заказчик/участок» when no matching Order — XOR with `orderId`. */
  @Prop({ trim: true })
  orderLabel?: string;

  @Prop({ required: true, default: 1, min: 0 })
  qty!: number;

  /** TZ-NX-SUPPLY-S4-RECEIVE-TO-STOCK — actual received qty (may differ from planned `qty`). */
  @Prop({ min: 0 })
  receivedQty?: number;

  @Prop({ trim: true })
  unit?: string;

  @Prop({ type: Date })
  neededBy?: Date;

  @Prop({
    enum: ['in_progress', 'requested', 'ordered', 'received', 'cancelled'],
    default: 'in_progress',
    index: true,
  })
  status!: SupplyRequestStatus;

  @Prop({ enum: ['urgent', 'normal', 'low'], default: 'normal' })
  priority!: SupplyRequestPriority;

  @Prop({ trim: true })
  notes?: string;

  @Prop({ min: 0 })
  priceHint?: number;

  @Prop({ min: 0 })
  lineTotal?: number;

  @Prop({ type: Date })
  supplierOrderDate?: Date;

  @Prop({ trim: true })
  responsible?: string;

  /** TZ-SUPPLY-BE-INVOICE-DELIVERY — счёт/доставка, независимы от status. */
  @Prop({ trim: true })
  invoiceNo?: string;

  @Prop({ trim: true })
  deliveryNote?: string;

  /** Отдельный флаг оплаты — не совпадает со `status` (received ≠ paid). */
  @Prop({ default: false })
  paid!: boolean;

  @Prop({ type: Date })
  paidAt?: Date;

  /** Кто создал заявку — проставляется сервером на create, с клиента не меняется. */
  @Prop({ type: Types.ObjectId, ref: 'User', index: true })
  createdBy?: Types.ObjectId;

  /** При статусе «Заказано» и наличии orderId+materialId — spawn'нутая задача реестра. */
  @Prop({ type: Types.ObjectId, ref: 'SupplyTask', index: true })
  linkedSupplyTaskId?: Types.ObjectId;

  @Prop({ type: Date, default: null, index: true })
  deletedAt?: Date | null;

  @Prop({ type: Date })
  createdAt?: Date;

  @Prop({ type: Date })
  updatedAt?: Date;
}

export const SupplyRequestSchema = SchemaFactory.createForClass(SupplyRequest);
SupplyRequestSchema.index({ organizationId: 1, status: 1, createdAt: -1 });
