import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type ProductRequestDocument = HydratedDocument<ProductRequest>;
export const REQUEST_STATUSES = ['open', 'confirmed', 'rejected'] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

/**
 * Заявка на создание нового изделия (ORDER-LINES): менеджер добавил в заказ «Новое изделие», проектировщик оформляет его в «Продукции».
 * Буфер лежит здесь, а не в `products` (общая с CRM). Только data-core, CRM не читает. Одна открытая заявка на одно название (`titleKey`):
 * то же изделие в другом заказе цепляется к ней. Позиции ссылаются на заявку через `incomes.productRequestId`.
 */
@Schema({ collection: 'productrequests', timestamps: true })
export class ProductRequest {
  @Prop({ required: true, trim: true }) title!: string;
  /** Нормализованное название (`aliasKey`) — по нему ищется открытая заявка. */
  @Prop({ required: true, trim: true }) titleKey!: string;
  @Prop({ trim: true }) description?: string;
  @Prop({ type: [Types.ObjectId], default: [] }) photoIds!: Types.ObjectId[];
  /** Σ количества живых позиций заявки (пересчитывается сервисом). */
  @Prop({ default: 0 }) qtyTotal!: number;
  @Prop({ enum: ['open', 'confirmed', 'rejected'], default: 'open' }) status!: RequestStatus;
  /** Итоговое изделие: созданное при подтверждении или выбранное при «Это дубль». */
  @Prop({ type: Types.ObjectId, ref: 'Product' }) productId?: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'User' }) createdBy?: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'User' }) confirmedBy?: Types.ObjectId;
  @Prop({ type: Date }) confirmedAt?: Date;
  @Prop({ type: Date, default: null, index: true }) deletedAt?: Date | null;
  @Prop({ type: Date }) createdAt?: Date;
  @Prop({ type: Date }) updatedAt?: Date;
}

export const ProductRequestSchema = SchemaFactory.createForClass(ProductRequest);
ProductRequestSchema.index({ status: 1, createdAt: -1 });
ProductRequestSchema.index({ titleKey: 1, status: 1 });
