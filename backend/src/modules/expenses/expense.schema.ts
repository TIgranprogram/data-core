import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type ExpenseDocument = HydratedDocument<Expense>;

/** «Прочие расходы» — факт оплаты, не прошедший через заявки снабжения (налоги, аренда, субподряд…). Только data-core. */
@Schema({ collection: 'expenses', timestamps: true })
export class Expense {
  @Prop({ type: Date, required: true }) date!: Date;
  @Prop({ type: Number, required: true, min: 0.01 }) amount!: number;
  /** Наша фирма, с которой заплатили. */
  @Prop({ type: Types.ObjectId, required: true }) companyId!: Types.ObjectId;
  /** Подстатья расхода (`expensearticles`). */
  @Prop({ type: Types.ObjectId, required: true }) articleId!: Types.ObjectId;
  /** Объект — заказ заказчика. */
  @Prop({ type: Types.ObjectId }) salesOrderId?: Types.ObjectId;
  @Prop({ type: String, required: true, trim: true }) title!: string;
  @Prop({ type: String, trim: true }) counterpartyName?: string;
  @Prop({ type: String, trim: true }) docNo?: string;
  @Prop({ type: [Types.ObjectId], default: [] }) fileIds!: Types.ObjectId[];
  @Prop({ type: String, trim: true }) comment?: string;
  @Prop({ type: Types.ObjectId }) createdBy?: Types.ObjectId;
  @Prop({ type: Date, default: null }) deletedAt?: Date | null;
}
export const ExpenseSchema = SchemaFactory.createForClass(Expense);
ExpenseSchema.index({ companyId: 1, date: 1, deletedAt: 1 });
