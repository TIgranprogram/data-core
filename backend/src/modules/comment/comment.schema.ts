import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type CommentDocument = HydratedDocument<Comment>;

@Schema({ collection: 'comments', timestamps: true })
export class Comment {
  @Prop({ required: true, index: true })
  packageTag!: string;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  authorId!: Types.ObjectId;

  @Prop()
  author?: string;

  @Prop({ required: true })
  text!: string;

  @Prop({ default: false, index: true })
  isArchived!: boolean;

  /** TZ-CORE-302: soft-delete timestamp; null = active. */
  @Prop({ type: Date, default: null, index: true })
  deletedAt?: Date | null;
}

export const CommentSchema = SchemaFactory.createForClass(Comment);
CommentSchema.index({ packageTag: 1, isArchived: 1, createdAt: -1 });
