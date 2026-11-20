import { Schema, Types } from 'mongoose';
/** Только сервер; общий IncomeDto выбор источника не принимает. */
export const PassportSelectionSchema = new Schema({
  mode: { type: String, enum: ['site', 'attachment'], required: true },
  revision: { type: Number, required: true, min: 0 },
  attachmentId: Types.ObjectId, attachmentGeneration: Number,
  productIdAtSelection: Types.ObjectId, confirmedAt: Date, confirmedBy: String,
  changedAt: Date, changedBy: String, invalidatedAt: Date,
  invalidReason: { type: String, enum: ['PRODUCT_CHANGED', 'ATTACHMENT_DELETED'] },
}, { _id: false, strict: true });
