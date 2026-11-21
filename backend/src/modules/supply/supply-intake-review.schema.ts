import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { InvoiceReviewDto } from './dto-invoice-review';

@Schema({ softDelete: false, timestamps: true, collection: 'supplyintakereviews', versionKey: false })
export class SupplyIntakeReview {
  @Prop({ type: String }) _id!: string;
  @Prop({ required: true }) actor!: string;
  @Prop({ required: true }) scopeHash!: string;
  @Prop({ required: true }) revision!: number;
  @Prop({ required: true }) fileId!: string;
  @Prop({ required: true }) payloadHash!: string;
  @Prop({ required: true }) requestHash!: string;
  @Prop({ required: true, type: Object }) input!: InvoiceReviewDto;
  @Prop({ required: true, type: String }) state!: 'validated' | 'committing' | 'committed' | 'question';
  @Prop({ type: [Object], default: [] }) requests!: { requestId: string; hash: string; reply: { draftId: string; revision: number; payloadHash: string; state: string; reason?: string } }[];
  @Prop() reason?: string;
  @Prop() ticketHash?: string;
  @Prop() expiresAt?: Date;
}

export const SupplyIntakeReviewSchema = SchemaFactory.createForClass(SupplyIntakeReview);
