import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type CounterDocument = HydratedDocument<Counter>;

@Schema({ collection: 'counters', timestamps: true, softDelete: false })
export class Counter {
  @Prop({ required: true, index: true })
  entity!: string;

  @Prop({ required: true })
  prefix!: string;

  @Prop({ required: true })
  year!: number;

  @Prop({ required: true, default: 0 })
  seq!: number;

  @Prop()
  name?: string;

  @Prop()
  value?: number;
}

export const CounterSchema = SchemaFactory.createForClass(Counter);

// Unique compound index — one counter per (entity, prefix, year).
CounterSchema.index({ entity: 1, prefix: 1, year: 1 }, { unique: true });
