import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type ShipmentDocument = HydratedDocument<Shipment>;

/** Строка отгрузки: позиция заказа (`incomes`), её название и единица на момент отгрузки, сколько отгружено. */
@Schema({ _id: false })
export class ShipmentLine {
  @Prop({ type: Types.ObjectId, required: true }) incomeId!: Types.ObjectId;
  @Prop({ type: String, trim: true }) title?: string;
  @Prop({ type: String, trim: true }) unit?: string;
  @Prop({ type: Number, required: true, min: 0 }) qty!: number;
}
const ShipmentLineSchema = SchemaFactory.createForClass(ShipmentLine);

/**
 * Отгрузка заказчику (ОТГ): часть заказа или весь заказ. Только data-core (`shipments`), CRM не читает.
 * Остаток позиции = `incomes.qty` − сумма `lines.qty` неудалённых отгрузок (не хранится). Склад не списывается.
 */
@Schema({ timestamps: true, collection: 'shipments' })
export class Shipment {
  @Prop({ type: Types.ObjectId, required: true, index: true }) orderId!: Types.ObjectId;
  /** «ОТГ-<№ заказа (productionNo), нет — № договора>-<n>»; n — счётчик по заказу, удалённые номера не переиспользуются. */
  @Prop({ type: String, required: true, index: true }) number!: string;
  /** Порядковый номер отгрузки внутри заказа (n в «ОТГ-№-n»); пара (orderId, seq) уникальна. */
  @Prop({ type: Number, required: true }) seq!: number;
  @Prop({ type: Date, required: true }) date!: Date;
  @Prop({ type: [ShipmentLineSchema], default: [] }) lines!: ShipmentLine[];
  @Prop({ type: Types.ObjectId }) whoId?: Types.ObjectId;
  @Prop({ type: String, trim: true }) whoName?: string;
  /** Почему отгружено не всё. */
  @Prop({ type: String, trim: true, maxlength: 500 }) reason?: string;
  @Prop({ type: String, trim: true, maxlength: 1000 }) note?: string;
  /** № документа (УПД / ТН). */
  @Prop({ type: String, trim: true, maxlength: 100 }) docNo?: string;
  /** Кто принял. */
  @Prop({ type: String, trim: true, maxlength: 200 }) receiver?: string;
  /** Ключ клиента: повтор создания с тем же ключом не делает вторую отгрузку. */
  @Prop({ type: String, index: true, sparse: true }) clientUid?: string;
  @Prop({ type: Date, default: null }) deletedAt?: Date | null;
  @Prop({ type: Types.ObjectId }) deletedById?: Types.ObjectId;
  @Prop({ type: String, trim: true }) deletedByName?: string;
  @Prop({ type: Date }) createdAt?: Date;
  @Prop({ type: Date }) updatedAt?: Date;
}

export const ShipmentSchema = SchemaFactory.createForClass(Shipment);
ShipmentSchema.index({ orderId: 1, deletedAt: 1, date: -1 });
ShipmentSchema.index({ orderId: 1, seq: 1 }, { unique: true });
