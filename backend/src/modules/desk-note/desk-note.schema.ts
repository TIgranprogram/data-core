import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type DeskNoteKind = 'note' | 'checklist' | 'reminder';
export type DeskNoteDocument = HydratedDocument<DeskNote>;

/**
 * TZ-DESK-408 — умный блокнот стола: быстрая заметка к заказу/изделию/модулю.
 * Не reuse `Comment` (packageTag — другой домен). Удаление hard (PO: compact).
 */
@Schema({ collection: 'desknotes', timestamps: true })
export class DeskNote {
  @Prop({ required: true, trim: true, maxlength: 4000 })
  text!: string;

  @Prop({ enum: ['note', 'checklist', 'reminder'], default: 'note', index: true })
  kind!: DeskNoteKind;

  @Prop({ type: Types.ObjectId, ref: 'Order', required: true, index: true })
  anchorOrderId!: Types.ObjectId;

  /** Идентификатор линии заказа (productId / lineId как строка) — как orderLineId в supply. */
  @Prop({ trim: true })
  anchorLineId?: string;

  @Prop({ type: Types.ObjectId, ref: 'ProductModule' })
  anchorModuleId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  authorId!: Types.ObjectId;

  /** checklist: выполнено. */
  @Prop({ default: false })
  isDone?: boolean;

  /** TZ-CORE-302: soft-delete timestamp; null = active. */
  @Prop({ type: Date, default: null, index: true })
  deletedAt?: Date | null;
}

export const DeskNoteSchema = SchemaFactory.createForClass(DeskNote);
DeskNoteSchema.index({ anchorOrderId: 1, createdAt: -1 }, { name: 'desknotes_order_created' });
DeskNoteSchema.index({ anchorLineId: 1 }, { name: 'desknotes_line' });
