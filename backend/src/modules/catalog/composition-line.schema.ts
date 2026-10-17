import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';

@Schema({ _id: false })
export class CompositionOverrideDimensions {
  @Prop({ min: 0 })
  length?: number;

  @Prop({ min: 0 })
  width?: number;

  @Prop({ min: 0 })
  height?: number;

  @Prop()
  unit?: string;
}

export const CompositionOverrideDimensionsSchema =
  SchemaFactory.createForClass(CompositionOverrideDimensions);

/** Embedded composition line. `_id` is intentionally enabled for line CRUD. */
@Schema({ _id: true })
export class CompositionLine {
  @Prop({ required: true, enum: ['module', 'material', 'product'] })
  lineType!: 'module' | 'material' | 'product';

  @Prop({ type: Types.ObjectId, required: true })
  refId!: Types.ObjectId;

  @Prop({ required: true, min: 0.000001 })
  quantity!: number;

  @Prop({ required: true, default: 0, min: 0 })
  sortOrder!: number;

  @Prop()
  unit?: string;

  @Prop({ type: CompositionOverrideDimensionsSchema })
  overrideDimensions?: {
    length?: number;
    width?: number;
    height?: number;
    unit?: string;
  };

  @Prop()
  isPurchased?: boolean;

  @Prop()
  sourcePosition?: string;

  @Prop()
  sourceCode?: string;

  @Prop({ min: 0 })
  unitPriceOverride?: number;

  @Prop()
  notes?: string;
}

export const CompositionLineSchema = SchemaFactory.createForClass(CompositionLine);
export type CompositionLineDocumentShape = CompositionLine & { _id: Types.ObjectId };
