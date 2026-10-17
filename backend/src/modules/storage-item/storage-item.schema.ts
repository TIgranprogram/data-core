import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

@Schema({ _id: false })
class StorageDimensionsSchema {
  @Prop() length?: number;
  @Prop() width?: number;
  @Prop() height?: number;
  @Prop() unit?: string;
}

const StorageDimensionsSchemaFactory = SchemaFactory.createForClass(StorageDimensionsSchema);

export type StorageItemDocument = HydratedDocument<StorageItem>;

@Schema({ collection: 'storageitems', timestamps: true })
export class StorageItem {
  @Prop({ type: Types.ObjectId, ref: 'Warehouse', required: true, index: true })
  warehouseId!: Types.ObjectId;

  /** Exactly one of productId/materialId is required (enforced in service/DTO boundary). */
  @Prop({ type: Types.ObjectId, ref: 'Product', index: true })
  productId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Material', index: true })
  materialId?: Types.ObjectId;

  @Prop()
  zoneName?: string;

  @Prop()
  name?: string;

  @Prop()
  description?: string;

  @Prop({ type: [String], default: [] })
  photos!: string[];

  @Prop()
  weightKg?: number;

  @Prop({ type: StorageDimensionsSchemaFactory })
  dimensions?: { length?: number; width?: number; height?: number; unit?: string };

  @Prop({ default: true, index: true })
  isActive!: boolean;

  @Prop({ default: 0 })
  quantity!: number;

  @Prop({ default: 0 })
  reservedQty!: number;

  @Prop({ default: 0 })
  minQuantity!: number;

  /** TZ-CORE-302: soft-delete timestamp; null = active. */
  @Prop({ type: Date, default: null, index: true })
  deletedAt?: Date | null;
}

export const StorageItemSchema = SchemaFactory.createForClass(StorageItem);

// Keep existing product uniqueness semantics and add the same semantics for materials.
//
// Discriminator uses `$type: 'objectId'`, NOT `$exists: true`: in a partial
// index filter MongoDB treats a missing field as `null` and `$exists: true`
// still indexes the document, so two material storage-items in one zone would
// collide on the product-side unique index (500 on the second create).
// Reproduced 2026-08-20 on the local stand via scripts/smoke/supply-smoke.mjs.
StorageItemSchema.index(
  { warehouseId: 1, productId: 1, zoneName: 1 },
  {
    unique: true,
    partialFilterExpression: { productId: { $type: 'objectId' }, zoneName: { $type: 'string' } },
  },
);
StorageItemSchema.index(
  { warehouseId: 1, productId: 1 },
  {
    unique: true,
    partialFilterExpression: { productId: { $type: 'objectId' }, zoneName: null },
  },
);
StorageItemSchema.index(
  { warehouseId: 1, materialId: 1, zoneName: 1 },
  {
    unique: true,
    partialFilterExpression: { materialId: { $type: 'objectId' }, zoneName: { $type: 'string' } },
  },
);
StorageItemSchema.index(
  { warehouseId: 1, materialId: 1 },
  {
    unique: true,
    partialFilterExpression: { materialId: { $type: 'objectId' }, zoneName: null },
  },
);
