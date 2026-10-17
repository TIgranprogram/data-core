import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

@Schema({ _id: false })
class BomComponentSchema {
  // TZ-83 cross-module side-effect: ProductComponent удалён в TZ-83 Фазе A.
  // BOM по смыслу ссылается на "продуктовую штуку" — теперь это ProductModule.
  // ref переключен на 'ProductModule'; имя поля `productComponentId` оставлено
  // чтобы не трогать DTO / frontend.
  //
  // TZ-105.2: orphan FK migration handled by `BomComponentResolveService`.
  // `required: false` (relaxed from `true` in this TZ): orphan rows resolved
  // via soft-detach set productComponentId = null. `null` + `required: true`
  // would throw Mongoose validation on next read. JSDoc on the migration
  // service explains runtime invariant — null is only valid for soft-detached
  // components with audit marker in `notes` (e.g. "[orphan-resolved 2026-07-12 TZ-105.2]").

  @Prop({ type: Types.ObjectId, ref: 'ProductModule', required: false })
  productComponentId?: Types.ObjectId | null;

  @Prop({ default: 1 })
  quantity!: number;

  @Prop()
  notes?: string;
}

const BomComponentSchemaFactory = SchemaFactory.createForClass(BomComponentSchema);

export type BomDocument = HydratedDocument<Bom>;

@Schema({ collection: 'boms', timestamps: true })
export class Bom {
  @Prop({ type: Types.ObjectId, ref: 'Product', required: true, index: true })
  productId!: Types.ObjectId;

  @Prop({ required: true })
  version!: string; // "1.0", "2026-01-15", etc.

  @Prop({ default: false, index: true })
  isActive!: boolean;

  @Prop({ type: [BomComponentSchemaFactory], default: [] })
  components!: { productComponentId?: Types.ObjectId | null; quantity: number; notes?: string }[];

  @Prop()
  effectiveFrom?: Date;

  @Prop()
  effectiveTo?: Date;

  @Prop()
  notes?: string;

  /** TZ-CORE-302: soft-delete timestamp; null = active. */
  @Prop({ type: Date, default: null, index: true })
  deletedAt?: Date | null;
}

export const BomSchema = SchemaFactory.createForClass(Bom);
BomSchema.index({ productId: 1, version: 1 }, { unique: true });
