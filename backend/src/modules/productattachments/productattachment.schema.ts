import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type ProductAttachmentDocument = HydratedDocument<ProductAttachment>;

/**
 * Вложение изделия (ВЛ-1): один файл — один вид. `products` не меняется (общая с CRM).
 * Удаление мягкое: файл на диске стирает ночная задача через 14 дней (BE-2).
 */
@Schema({ collection: 'productattachments', timestamps: true })
export class ProductAttachment {
  @Prop({ type: Types.ObjectId, required: true }) productId!: Types.ObjectId;
  /** Строка справочника «Виды вложений» (`dict_values`, dict=attachmentTypes). */
  @Prop({ type: Types.ObjectId, required: true }) typeId!: Types.ObjectId;
  @Prop({ type: String, required: true }) originalName!: string;
  /** Относительно папки загрузок: `attachments/<изделие>/<вид>/<uuid>.<ext>`. Клиенту не отдаётся. */
  @Prop({ type: String, required: true }) storedPath!: string;
  @Prop({ type: Number, required: true }) size!: number;
  @Prop({ type: String }) mime?: string;
  @Prop({ type: String, required: true }) ext!: string;
  @Prop({ type: String }) uploadedBy?: string;
  @Prop({ type: String }) uploadedByName?: string;
  @Prop({ type: Date, default: () => new Date() }) uploadedAt!: Date;
  @Prop({ type: Date, default: null }) deletedAt?: Date | null;
  @Prop({ type: String }) deletedBy?: string;
}
export const ProductAttachmentSchema = SchemaFactory.createForClass(ProductAttachment);
ProductAttachmentSchema.index({ productId: 1, typeId: 1, deletedAt: 1 });
ProductAttachmentSchema.index({ typeId: 1 });
