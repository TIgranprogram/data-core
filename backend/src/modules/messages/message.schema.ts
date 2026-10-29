import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type MessageDocument = HydratedDocument<Message>;

export const MESSAGE_MAX = 2000;

/** Сообщение мини-чата (`messages`, только data-core; без мягкого удаления). */
@Schema({ softDelete: false, timestamps: { createdAt: true, updatedAt: false }, collection: 'messages' })
export class Message {
  @Prop({ type: Types.ObjectId, required: true }) fromUserId!: Types.ObjectId;
  /** У «Всем» (`toAll`) не задан. */
  @Prop({ type: Types.ObjectId }) toUserId?: Types.ObjectId;
  /** Сообщение всем активным сотрудникам. Нет поля = false. */
  @Prop({ type: Boolean, default: false }) toAll?: boolean;
  /** Текст необязателен, если есть фото. */
  @Prop({ type: String, default: '', trim: true, maxlength: MESSAGE_MAX }) text!: string;
  @Prop({ type: [Types.ObjectId], default: undefined }) photoIds?: Types.ObjectId[];
  @Prop({ type: Date, default: null }) readAt?: Date | null;
}

export const MessageSchema = SchemaFactory.createForClass(Message);
MessageSchema.index({ fromUserId: 1, toUserId: 1, createdAt: -1 });
MessageSchema.index({ toUserId: 1, readAt: 1 });
MessageSchema.index({ toAll: 1, createdAt: -1 });

export type MessageReadDocument = HydratedDocument<MessageRead>;

/** Когда пользователь последний раз открыл «Всем» (`messagereads`, unique userId+channel). */
@Schema({ softDelete: false, timestamps: false, collection: 'messagereads' })
export class MessageRead {
  @Prop({ type: Types.ObjectId, required: true }) userId!: Types.ObjectId;
  @Prop({ type: String, required: true }) channel!: string;
  @Prop({ type: Date, required: true }) readAt!: Date;
}

export const MessageReadSchema = SchemaFactory.createForClass(MessageRead);
MessageReadSchema.index({ userId: 1, channel: 1 }, { unique: true });
