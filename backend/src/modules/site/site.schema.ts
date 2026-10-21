import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type SiteDocument = HydratedDocument<Site>;

/**
 * TZ-ORDERS-303 — площадка/объект заказчика (адрес).
 * 1 Counterparty → N Site; Order.siteId → одна площадка.
 */
@Schema({ collection: 'sites', timestamps: true })
export class Site {
  @Prop({ type: Types.ObjectId, ref: 'Counterparty', required: true, index: true })
  counterpartyId!: Types.ObjectId;

  @Prop({ required: true, trim: true })
  name!: string;

  @Prop({ required: true, trim: true })
  address!: string;

  @Prop({ default: true, index: true })
  isActive!: boolean;

  @Prop({ type: Date, default: null, index: true })
  deletedAt?: Date | null;
}

export const SiteSchema = SchemaFactory.createForClass(Site);
SiteSchema.index({ counterpartyId: 1, name: 1 });
