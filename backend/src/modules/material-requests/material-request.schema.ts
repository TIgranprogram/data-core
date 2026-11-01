import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type MaterialRequestDocument = HydratedDocument<MaterialRequest>;
export const MATERIAL_REQUEST_STATUSES = ['open', 'done', 'rejected'] as const;
export type MaterialRequestStatus = (typeof MATERIAL_REQUEST_STATUSES)[number];

/**
 * Заявка кладовщика на новую позицию склада (нет в списке при «Принять»): текст, необязательное количество, склад-зона, автор.
 * Отдельно от `productrequests` (там изделия: titleKey, позиции заказов, подтверждение через «Продукцию»). Только data-core.
 */
@Schema({ collection: 'materialrequests', timestamps: true })
export class MaterialRequest {
  @Prop({ required: true, trim: true }) text!: string;
  @Prop({ type: Number }) qty?: number;
  /** Склад (stockzones), в котором подана заявка. */
  @Prop({ type: Types.ObjectId, index: true }) zoneId?: Types.ObjectId;
  @Prop({ enum: ['open', 'done', 'rejected'], default: 'open' }) status!: MaterialRequestStatus;
  /** Созданная по заявке позиция (materials). */
  @Prop({ type: Types.ObjectId }) materialId?: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'User' }) createdBy?: Types.ObjectId;
  @Prop({ type: String, trim: true }) createdByName?: string;
  @Prop({ type: Types.ObjectId, ref: 'User' }) closedBy?: Types.ObjectId;
  @Prop({ type: Date }) closedAt?: Date;
  @Prop({ type: Date, default: null, index: true }) deletedAt?: Date | null;
  @Prop({ type: Date }) createdAt?: Date;
  @Prop({ type: Date }) updatedAt?: Date;
}

export const MaterialRequestSchema = SchemaFactory.createForClass(MaterialRequest);
MaterialRequestSchema.index({ status: 1, createdAt: -1 });
