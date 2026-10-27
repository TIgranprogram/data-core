import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type DesignStickerDocument = HydratedDocument<DesignSticker>;

export const STICKER_KINDS = ['system', 'number', 'state'] as const;
export type StickerKind = (typeof STICKER_KINDS)[number];
/** Поле задачи, из которого строится системный стикер. */
export const SYSTEM_FIELDS = ['assignee', 'deadline', 'priority', 'order', 'product'] as const;

export interface StickerState { id: string; label: string; color?: string }

/**
 * Стикер доски проектирования — метка на карточке. Системные (`kind:'system'`) строятся из полей задачи и создаются сидом,
 * их нельзя удалить, только скрыть. Свои: `number` (число, подпись, единица) и `state` (набор состояний с цветами).
 * Значения — в `designtasks.stickers[<_id>]`. Удаление — soft; значения в задачах не чистятся.
 */
@Schema({ timestamps: true, collection: 'designstickers' })
export class DesignSticker {
  @Prop({ type: String, default: 'main' }) boardKey!: string;
  @Prop({ type: String, required: true, trim: true }) key!: string;
  @Prop({ type: String, required: true, trim: true }) label!: string;
  @Prop({ type: String, enum: STICKER_KINDS, required: true }) kind!: StickerKind;
  @Prop({ type: String, enum: SYSTEM_FIELDS }) systemField?: string;
  @Prop({ type: String, trim: true }) unit?: string;
  @Prop({ type: [{ id: String, label: String, color: String, _id: false }], default: undefined }) states?: StickerState[];
  @Prop({ type: Boolean, default: true }) visible!: boolean;
  @Prop({ type: Number, default: 100 }) order!: number;
  @Prop({ type: Date, default: null }) deletedAt?: Date | null;
}

export const DesignStickerSchema = SchemaFactory.createForClass(DesignSticker);
// уникальный ключ в доске среди живых (partial: в 4.4 допустим только равенство)
DesignStickerSchema.index({ boardKey: 1, key: 1 }, { unique: true, partialFilterExpression: { deletedAt: null } });
