import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type OfferDocument = HydratedDocument<CommercialOffer>;
export type OfferBackgroundDocument = HydratedDocument<OfferBackground>;

export const OFFER_STATUSES = ['draft', 'sent', 'accepted', 'paid', 'rejected', 'cancelled'] as const;
export type OfferStatus = (typeof OFFER_STATUSES)[number];

/** Строка КП: изделие каталога необязательно (бывает свободный текст). */
@Schema({ _id: false })
export class OfferItem {
  @Prop({ type: Types.ObjectId }) productId?: Types.ObjectId;
  @Prop({ type: String, required: true, trim: true, maxlength: 300 }) productName!: string;
  @Prop({ type: String, trim: true, maxlength: 100 }) productSku?: string;
  @Prop({ type: String, trim: true, maxlength: 1000 }) description?: string;
  @Prop({ type: String, trim: true, maxlength: 100 }) color?: string;
  @Prop({ type: String, trim: true, maxlength: 100 }) size?: string;
  @Prop({ type: String, trim: true, maxlength: 500 }) photoUrl?: string;
  @Prop({ type: Number, required: true, min: 0 }) quantity!: number;
  @Prop({ type: String, trim: true, default: 'шт', maxlength: 20 }) unit!: string;
  @Prop({ type: Number, min: 0 }) unitPrice?: number;
  @Prop({ type: Number, default: 0 }) total!: number;
}
const OfferItemSchema = SchemaFactory.createForClass(OfferItem);

@Schema({ _id: false })
export class OfferStatusEntry {
  @Prop({ type: String, required: true }) status!: string;
  @Prop({ type: Date, required: true }) at!: Date;
  @Prop({ type: String }) by?: string;
}
const OfferStatusEntrySchema = SchemaFactory.createForClass(OfferStatusEntry);

/**
 * Коммерческое предложение (КП-1). Только data-core: CRM-овские `quotations` не трогаем.
 * Номер — счётчик `CommercialOffer` («КП-…»), как у `POST /showcase/kp`.
 */
@Schema({ timestamps: true, collection: 'commercialoffers' })
export class CommercialOffer {
  @Prop({ type: String, required: true, index: true }) number!: string;
  @Prop({ type: Date, required: true }) date!: Date;
  @Prop({ type: Date }) validUntil?: Date;
  @Prop({ type: Types.ObjectId, required: true }) companyId!: Types.ObjectId;
  @Prop({ type: String, required: true, trim: true, maxlength: 300 }) customer!: string;
  @Prop({ type: Types.ObjectId }) counterpartyId?: Types.ObjectId;
  @Prop({ type: String, trim: true, maxlength: 300 }) title?: string;
  @Prop({ type: String, enum: OFFER_STATUSES, default: 'draft', index: true }) status!: OfferStatus;
  @Prop({ type: [OfferItemSchema], default: [] }) items!: OfferItem[];
  @Prop({ type: Number, default: 0 }) total!: number;
  @Prop({ type: Number, min: 0, max: 100 }) prepaymentPercent?: number;
  @Prop({ type: Number, min: 0 }) productionDays?: number;
  @Prop({ type: Number, min: 0 }) deliveryDays?: number;
  @Prop({ type: String, trim: true, maxlength: 3000 }) terms?: string;
  @Prop({ type: String, trim: true, maxlength: 2000 }) notes?: string;
  /** Фон страницы 1 / страниц 2+: id из `offerbackgrounds`; пусто — по умолчанию; «none» у фона 2 — белая страница. */
  @Prop({ type: String }) bg1Id?: string;
  @Prop({ type: String }) bg2Id?: string;
  /** Заказ, созданный из КП (этап 2). */
  @Prop({ type: Types.ObjectId }) orderId?: Types.ObjectId;
  @Prop({ type: [OfferStatusEntrySchema], default: [] }) statusHistory!: OfferStatusEntry[];
  @Prop({ type: Date, default: null }) deletedAt?: Date | null;
  @Prop({ type: Date }) createdAt?: Date;
  @Prop({ type: Date }) updatedAt?: Date;
}
export const CommercialOfferSchema = SchemaFactory.createForClass(CommercialOffer);
CommercialOfferSchema.index({ deletedAt: 1, date: -1 });

/** Загруженный фон КП. `file` — ссылка `/uploads/offers/<имя>`. */
@Schema({ softDelete: false, timestamps: true, collection: 'offerbackgrounds' })
export class OfferBackground {
  @Prop({ type: String, required: true, trim: true, maxlength: 100 }) name!: string;
  @Prop({ type: Number, required: true, enum: [1, 2] }) page!: 1 | 2;
  @Prop({ type: String, required: true }) file!: string;
  @Prop({ type: Boolean, default: false }) isDefault!: boolean;
}
export const OfferBackgroundSchema = SchemaFactory.createForClass(OfferBackground);
