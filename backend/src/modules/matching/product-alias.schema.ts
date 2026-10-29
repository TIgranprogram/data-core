import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type ProductAliasDocument = HydratedDocument<ProductAlias>;

/**
 * Справочник соответствий «как написано в договоре → изделие» (КМ2). Только data-core, CRM не читает.
 * Пишется при подтверждении сопоставления: та же формулировка в другом договоре предлагается сразу.
 */
@Schema({ collection: 'productaliases', timestamps: true, softDelete: false })
export class ProductAlias {
  /** Нормализованное короткое название из договора (`aliasKey`). */
  @Prop({ required: true, trim: true }) key!: string;
  @Prop({ type: Types.ObjectId, ref: 'Product', required: true }) productId!: Types.ObjectId;
  /** Сколько раз подтверждали. */
  @Prop({ default: 0 }) count!: number;
  @Prop({ type: Date }) lastAt?: Date;
}

export const ProductAliasSchema = SchemaFactory.createForClass(ProductAlias);
ProductAliasSchema.index({ key: 1 }, { unique: true });
