import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type SupplierItemDocument = HydratedDocument<SupplierItem>;

/** Одна запись истории цен. */
@Schema({ _id: false })
export class PriceHistoryEntry {
  @Prop({ required: true })
  price!: number;

  @Prop({ required: true, default: () => new Date() })
  date!: Date;

  /** excel — прайс; request — заявка; stock — склад; manual — вручную. */
  @Prop({ required: true, enum: ['excel', 'request', 'stock', 'manual'] })
  source!: 'excel' | 'request' | 'stock' | 'manual';
}

const PriceHistoryEntrySchema = SchemaFactory.createForClass(PriceHistoryEntry);

/**
 * Позиция каталога поставщика (`supplieritems`).
 * Ключ уникальности: supplierId + article + color.
 * Создаётся и обновляется при загрузке Excel (СКЕ-2) и из заявок (СКЕ-3).
 */
@Schema({ collection: 'supplieritems', timestamps: true })
export class SupplierItem {
  @Prop({ type: Types.ObjectId, ref: 'Organization', required: true, index: true })
  supplierId!: Types.ObjectId;

  @Prop({ required: true, trim: true })
  article!: string;

  @Prop({ required: true, trim: true })
  name!: string;

  @Prop({ trim: true })
  color?: string;

  @Prop({ min: 0 })
  priceHint?: number;

  /** Оптовая группа из прайса поставщика. */
  @Prop({ trim: true })
  optGroup?: string;

  /** URL фото — внешний URL из прайса или наше хранилище. */
  @Prop({ trim: true })
  photoUrl?: string;

  /** Откуда последнее обновление: excel | request | stock | manual. */
  @Prop({ enum: ['excel', 'request', 'stock', 'manual'], default: 'excel' })
  source?: 'excel' | 'request' | 'stock' | 'manual';

  // ── Каталог v2 (необязательные; CRM их не читает) ──
  /** Наш материал; нет — ещё не сопоставлено. */
  @Prop({ type: Types.ObjectId, ref: 'Material', index: true, sparse: true })
  materialId?: Types.ObjectId;

  @Prop({ trim: true })
  unit?: string;

  /** Копия категории материала — для фильтра. */
  @Prop({ type: Types.ObjectId, ref: 'Category', index: true, sparse: true })
  categoryId?: Types.ObjectId;

  /** Дата последней цены. */
  @Prop({ type: Date })
  priceDate?: Date;

  @Prop()
  inStock?: boolean;

  @Prop({ trim: true })
  note?: string;

  /** История цен — заполняется при каждом upsert с другой ценой (СКЕ-5). */
  @Prop({ type: [PriceHistoryEntrySchema], default: [] })
  priceHistory!: PriceHistoryEntry[];

  @Prop({ type: Date, default: null, index: true })
  deletedAt?: Date | null;
}

export const SupplierItemSchema = SchemaFactory.createForClass(SupplierItem);
SupplierItemSchema.index({ supplierId: 1, article: 1, color: 1 }, { unique: true, sparse: false });
