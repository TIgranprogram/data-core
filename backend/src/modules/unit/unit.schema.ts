import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type UnitDocument = HydratedDocument<Unit>;

/**
 * Catalog of measurement units used by Materials, Products, etc.
 *
 * `key` is the canonical slug the rest of the system stores in free-text
 * `Material.unit` / `ProductModule.materials.unit` fields; `label` /
 * `symbol` / `category` are display-only metadata.
 *
 * `isSystem` protects seeded keys (`kg`, `m²`, …) from accidental
 * deletion — once these are baked into existing rows, removing them
 * would silently break form dropdowns.
 */
@Schema({ softDelete: false,  collection: 'units', timestamps: true })
export class Unit {
  @Prop({ required: true, unique: true, index: true })
  key!: string;

  @Prop({ required: true })
  label!: string;

  @Prop()
  symbol?: string;

  @Prop({ index: true })
  category?: string; // 'mass' | 'length' | 'area' | 'volume' | 'count' | ...

  @Prop({ default: true, index: true })
  isActive!: boolean;

  @Prop({ default: false })
  isSystem!: boolean;

  @Prop({ default: 0 })
  sortOrder!: number;
}

export const UnitSchema = SchemaFactory.createForClass(Unit);

// Index for the dropdown-companion query `find({ isActive: true }).sort(...)`.
UnitSchema.index({ isActive: 1, sortOrder: 1, key: 1 });
