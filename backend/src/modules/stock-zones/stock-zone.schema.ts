import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type StockZoneDocument = HydratedDocument<StockZone>;

/**
 * Склад-зона (справочник «Склады»): какие позиции видит кладовщик. Не путать с `warehouses` (физические склады CRM).
 * Позиции склада = категории (с подкатегориями) + добавки поштучно − исключения поштучно.
 */
@Schema({ collection: 'stockzones', timestamps: true })
export class StockZone {
  @Prop({ type: String, required: true, trim: true }) name!: string;
  @Prop({ type: [Types.ObjectId], default: [] }) categoryIds!: Types.ObjectId[];
  @Prop({ type: [Types.ObjectId], default: [] }) includeMaterialIds!: Types.ObjectId[];
  @Prop({ type: [Types.ObjectId], default: [] }) excludeMaterialIds!: Types.ObjectId[];
  /** «Основной»: дополнительно позиции без категории. Один на весь справочник. */
  @Prop({ type: Boolean, default: false }) isDefault!: boolean;
  @Prop({ type: Number, default: 100 }) order!: number;
  @Prop({ type: Date, default: null }) deletedAt?: Date | null;
}
export const StockZoneSchema = SchemaFactory.createForClass(StockZone);
StockZoneSchema.index({ deletedAt: 1, order: 1 });
