import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type WorkNoteDocument = HydratedDocument<WorkNote>;

@Schema({ timestamps: true, collection: 'worknotes' })
export class WorkNote {
  @Prop({ type: Types.ObjectId, required: true }) taskId!: Types.ObjectId;
  @Prop({ type: Types.ObjectId, required: true }) authorId!: Types.ObjectId;
  @Prop({ type: String, default: '', trim: true, maxlength: 4000 }) text!: string;
  @Prop({ type: [Types.ObjectId], default: [] }) photoIds!: Types.ObjectId[];
  @Prop({ type: Date, default: null }) deletedAt?: Date | null;
  @Prop({ type: Date }) createdAt?: Date;
}

export const WorkNoteSchema = SchemaFactory.createForClass(WorkNote);
WorkNoteSchema.index({ taskId: 1, deletedAt: 1, createdAt: 1, _id: 1 });
