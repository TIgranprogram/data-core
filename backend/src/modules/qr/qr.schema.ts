import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { QR_TYPES } from './qr-code';

export type QrCodeDocument = HydratedDocument<QrCode>;

/** QR-код позиции склада / изделия. Код не удаляется вместе с позицией; общих с CRM полей нет. */
@Schema({ softDelete: false, timestamps: { createdAt: true, updatedAt: false }, collection: 'qrcodes' })
export class QrCode {
  @Prop({ type: String, required: true, unique: true }) code!: string;
  @Prop({ type: String, required: true, enum: QR_TYPES }) entityType!: string;
  @Prop({ type: Types.ObjectId, required: true }) entityId!: Types.ObjectId;
  @Prop({ type: Date, default: null }) deletedAt?: Date | null;
}
export const QrCodeSchema = SchemaFactory.createForClass(QrCode);
QrCodeSchema.index({ entityType: 1, entityId: 1 }, { unique: true });
