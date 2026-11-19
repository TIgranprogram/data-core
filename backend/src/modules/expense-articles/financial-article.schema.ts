import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';

/** Та же существующая коллекция; старые поля не материализуются чтением. */
@Schema({ collection: 'expensearticles', timestamps: true })
export class FinancialArticle {
  @Prop({ required: true }) name!: string;
  @Prop({ enum: ['income', 'expense'] }) type?: string;
  @Prop({ type: Types.ObjectId }) parentId?: Types.ObjectId | null;
  @Prop({ enum: ['group', 'article'] }) nodeKind?: string;
  @Prop() selectable?: boolean;
  @Prop() sortOrder?: number;
  @Prop() code?: string;
  @Prop({ type: [Types.ObjectId] }) categoryIds?: Types.ObjectId[];
  @Prop() version?: number;
  @Prop({ type: Date }) archivedAt?: Date | null;
  @Prop({ type: Date, default: null }) deletedAt?: Date | null;
  @Prop({ type: Types.ObjectId }) createdBy?: Types.ObjectId;
  @Prop({ type: Types.ObjectId }) updatedBy?: Types.ObjectId;
}
export const FinancialArticleSchema = SchemaFactory.createForClass(FinancialArticle);
FinancialArticleSchema.index({ type: 1, parentId: 1, deletedAt: 1, archivedAt: 1, sortOrder: 1 });
