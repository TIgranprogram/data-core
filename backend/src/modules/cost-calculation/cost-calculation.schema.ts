import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

@Schema({ _id: false })
export class CostMaterial {
  @Prop({ type: Types.ObjectId, ref: 'Material', required: true })
  materialId!: Types.ObjectId;

  @Prop()
  materialName?: string;

  @Prop({ default: 0 })
  quantity!: number;

  @Prop()
  unit?: string;

  @Prop({ default: 0 })
  pricePerUnit!: number;

  @Prop({ default: 0 })
  total!: number;
}

const CostMaterialSchema = SchemaFactory.createForClass(CostMaterial);

@Schema({ _id: false })
export class CostLabor {
  @Prop({ type: Types.ObjectId, ref: 'WorkType', required: true })
  workTypeId!: Types.ObjectId;

  @Prop()
  workTypeName?: string;

  @Prop({ default: 0 })
  hours!: number;

  @Prop({ default: 0 })
  hourlyRate!: number;

  @Prop({ default: 0 })
  total!: number;
}

const CostLaborSchema = SchemaFactory.createForClass(CostLabor);

/** TZ-COST-305: product-line contribution snapshot (complex BOM). */
export type CostProductLineSource = 'override' | 'costPrice' | 'none';

@Schema({ _id: false })
export class CostProductLine {
  @Prop({ type: Types.ObjectId, ref: 'Product', required: true })
  productId!: Types.ObjectId;

  @Prop()
  productName?: string;

  @Prop({ default: 1 })
  quantity!: number;

  @Prop({ default: 0 })
  unitCost!: number;

  @Prop({ default: 0 })
  total!: number;

  @Prop({ required: true, enum: ['override', 'costPrice', 'none'] })
  source!: CostProductLineSource;
}

const CostProductLineSchema = SchemaFactory.createForClass(CostProductLine);

export type CostCalculationDocument = HydratedDocument<CostCalculation>;

@Schema({ collection: 'costcalculations', timestamps: true })
export class CostCalculation {
  @Prop({ type: Types.ObjectId, ref: 'Product', required: true, index: true })
  productId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Bom' })
  bomId?: Types.ObjectId;

  @Prop()
  bomVersion?: string;

  @Prop({ default: false, index: true })
  isActive!: boolean;

  @Prop({ type: [CostMaterialSchema], default: [] })
  materials!: CostMaterial[];

  @Prop({ default: 0 })
  totalMaterialCost!: number;

  @Prop({ type: [CostLaborSchema], default: [] })
  labor!: CostLabor[];

  @Prop({ default: 0 })
  totalLaborCost!: number;

  /** TZ-COST-305: product-in-product lines (not in overhead base). */
  @Prop({ type: [CostProductLineSchema], default: [] })
  productLines!: CostProductLine[];

  @Prop({ default: 0 })
  totalProductLineCost!: number;

  @Prop({ default: 10 })
  overheadPercent!: number;

  @Prop({ default: 0 })
  overheadCost!: number;

  @Prop({ default: 0 })
  totalCost!: number;

  @Prop()
  calculatedAt?: Date;

  @Prop()
  notes?: string;

  /** Soft-delete marker — excluded from list queries. */
  @Prop({ index: true })
  deletedAt?: Date;

  /** Non-fatal rollup notes (e.g. cycle skips, missing child cost). TZ-COST-302/305. */
  @Prop({ type: [String], default: [] })
  infos?: string[];
}

export const CostCalculationSchema = SchemaFactory.createForClass(CostCalculation);
CostCalculationSchema.index({ productId: 1, isActive: 1 });
