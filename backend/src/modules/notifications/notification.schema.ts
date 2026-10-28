import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { NOTICE_KINDS, type NoticeKind } from './notification-kind';

export type NotificationDocument = HydratedDocument<Notification>;

/**
 * Серверное уведомление пользователю (`notifications`, только data-core; CRM не читает).
 * `kind` у старых записей может отсутствовать — вид тогда считается по `type` (`kindOf`).
 */
@Schema({ softDelete: false, timestamps: true, collection: 'notifications' })
export class Notification {
  @Prop({ type: Types.ObjectId, required: true }) userId!: Types.ObjectId;
  @Prop({ type: String, required: true, trim: true, maxlength: 60 }) type!: string;
  @Prop({ type: String, enum: NOTICE_KINDS }) kind?: NoticeKind;
  @Prop({ type: String, required: true, trim: true, maxlength: 500 }) text!: string;
  @Prop({ type: String, trim: true, maxlength: 300 }) sub?: string;
  /** Куда перейти по нажатию (хэш приложения). */
  @Prop({ type: String, trim: true, maxlength: 300 }) href?: string;
  @Prop({ type: Types.ObjectId }) fromUserId?: Types.ObjectId;
  @Prop({ type: Date, default: null }) readAt?: Date | null;
}

export const NotificationSchema = SchemaFactory.createForClass(Notification);
NotificationSchema.index({ userId: 1, createdAt: -1 });
NotificationSchema.index({ userId: 1, readAt: 1 });
