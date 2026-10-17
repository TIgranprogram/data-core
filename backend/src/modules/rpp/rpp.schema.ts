import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type RppStatus = 'draft' | 'submitted' | 'registered' | 'active' | 'expired' | 'cancelled';
export type RppDocument = HydratedDocument<Rpp>;

@Schema({ collection: 'rpps', timestamps: true })
export class Rpp {
  @Prop({ required: true, unique: true, index: true })
  number!: string;

  @Prop()
  title?: string;

  @Prop({ type: Types.ObjectId, ref: 'Product', required: true, index: true })
  productId!: Types.ObjectId;

  @Prop()
  productName?: string;

  @Prop()
  productSku?: string;

  @Prop()
  registryNumber?: string;

  @Prop({ enum: ['draft', 'submitted', 'registered', 'active', 'expired', 'cancelled'], default: 'draft', index: true })
  status!: RppStatus;

  @Prop()
  submissionDate?: Date;

  @Prop()
  registrationDate?: Date;

  @Prop({ index: true })
  expiryDate?: Date;

  @Prop()
  notes?: string;

  /** TZ-CORE-302: soft-delete timestamp; null = active. */
  @Prop({ type: Date, default: null, index: true })
  deletedAt?: Date | null;
}

export const RppSchema = SchemaFactory.createForClass(Rpp);
RppSchema.index({ productId: 1, status: 1 });
