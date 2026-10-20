import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type CurrencyDocument = HydratedDocument<Currency>;

@Schema({ softDelete: false,  collection: 'currencies', timestamps: true })
export class Currency {
  @Prop({ required: true, unique: true, index: true })
  key!: string;

  @Prop({ required: true })
  label!: string;

  @Prop({ required: true })
  code!: string;

  @Prop({ required: true })
  symbol!: string;

  @Prop({ type: Number, default: 1.0 })
  rate!: number;

  @Prop({ default: false })
  isBase!: boolean;

  @Prop({ default: 'ru-RU' })
  locale!: string;

  @Prop({ type: Number, default: 2 })
  precision!: number;

  @Prop({ default: 0 })
  sortOrder!: number;

  @Prop({ default: true, index: true })
  isActive!: boolean;

  @Prop({ default: false })
  isSystem!: boolean;
}

export const CurrencySchema = SchemaFactory.createForClass(Currency);

CurrencySchema.index({ isActive: 1, sortOrder: 1, key: 1 });
