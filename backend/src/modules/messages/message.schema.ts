import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type MessageDocument = HydratedDocument<Message>;

export const MESSAGE_MAX = 2000;

/** Сообщение мини-чата (`messages`, только data-core; без мягкого удаления). */
@Schema({ softDelete: false, timestamps: { createdAt: true, updatedAt: false }, collection: 'messages' })
export class Message {
  @Prop({ type: Types.ObjectId, required: true }) fromUserId!: Types.ObjectId;
  @Prop({ type: Types.ObjectId, required: true }) toUserId!: Types.ObjectId;
  @Prop({ type: String, required: true, trim: true, maxlength: MESSAGE_MAX }) text!: string;
  @Prop({ type: Date, default: null }) readAt?: Date | null;
}

export const MessageSchema = SchemaFactory.createForClass(Message);
MessageSchema.index({ fromUserId: 1, toUserId: 1, createdAt: -1 });
MessageSchema.index({ toUserId: 1, readAt: 1 });
