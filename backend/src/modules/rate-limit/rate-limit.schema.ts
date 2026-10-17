import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type RateLimitEntryDocument = HydratedDocument<RateLimitEntry>;

@Schema({ collection: 'rate_limit_entries', timestamps: true, softDelete: false })
export class RateLimitEntry {
  @Prop({ required: true, unique: true, index: true })
  key!: string;

  @Prop({ default: 0 })
  count!: number;

  @Prop({ required: true, index: { expires: 0 } })
  expiresAt!: Date;
}

export const RateLimitEntrySchema = SchemaFactory.createForClass(RateLimitEntry);
