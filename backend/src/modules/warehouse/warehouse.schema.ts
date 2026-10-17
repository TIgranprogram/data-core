import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type WarehouseType = 'main' | 'branch' | 'transit' | 'production' | 'other';
export type WarehouseDocument = HydratedDocument<Warehouse>;

@Schema({ collection: 'warehouses', timestamps: true })
export class Warehouse {
  @Prop({ required: true, index: true })
  name!: string;

  @Prop({ required: true, enum: ['main', 'branch', 'transit', 'production', 'other'], default: 'main' })
  type!: WarehouseType;

  @Prop()
  address?: string;

  @Prop()
  description?: string;

  @Prop({ default: true, index: true })
  isActive!: boolean;

  /** TZ-NX-WAREHOUSE-DEFAULT — exactly one true at a time (service-enforced). */
  @Prop({ default: false, index: true })
  isDefault!: boolean;

  /** Legacy zone names (string array). */
  @Prop({ type: [String], default: [] })
  zoneNames!: string[];

  @Prop({ type: [Types.ObjectId], ref: 'Role', default: [] })
  roleIds!: Types.ObjectId[];

  @Prop({ type: Date, default: null, index: true })
  deletedAt?: Date | null;
}

export const WarehouseSchema = SchemaFactory.createForClass(Warehouse);
