import { Schema, Types } from 'mongoose';
import type { mongo } from 'mongoose';
type MongoDocument = mongo.Document;

export interface ArchiveFile {
  id: string;
  kind: 'photo' | 'attachment' | 'print' | 'passportPdf' | 'shipmentPdf';
  sourceId: Types.ObjectId;
  name: string;
  mime: string;
  passportRevision?: number;
  sha256: string;
  size: number;
}

export interface ArchiveBundle {
  order: MongoDocument;
  lines: MongoDocument[];
  passports: MongoDocument[];
  attachments: MongoDocument[];
  shipments: MongoDocument[];
  work: MongoDocument[];
  design: MongoDocument[];
  plans: MongoDocument[];
  organizations: MongoDocument[];
  files: ArchiveFile[];
}

export const ARCHIVES = 'salesorderarchives';
export const REOPENS = 'salesorderarchivereopens';
export const CHUNKS = 'salesorderarchivechunks';

// Записи только добавляются. У возобновления отдельная квитанция, старый комплект не обновляется.
const options = { timestamps: false, softDelete: false };
export const ArchiveSchema = new Schema({
  orderId: Schema.Types.ObjectId, version: Number, archivedAt: Date, archivedBy: String, actorId: String,
  reason: String, clientUid: String, requestHash: String, stateVersion: Number, confirmations: Object, order: Object, lines: [Object], shipments: [Object], work: [Object],
  design: [Object], plans: [Object], organizations: [Object], passports: [Object], attachments: [Object], files: [Object],
}, { ...options, collection: ARCHIVES });
ArchiveSchema.index({ orderId: 1, version: 1 }, { unique: true });
ArchiveSchema.index({ 'files.sourceId': 1 });
export const ArchiveReopenSchema = new Schema({
  orderId: Schema.Types.ObjectId, version: Number, reopenedAt: Date, reopenedBy: String, actorId: String, reopenReason: String, clientUid: String, requestHash: String, stateVersion: Number,
}, { ...options, collection: REOPENS });
ArchiveReopenSchema.index({ orderId: 1, version: 1 }, { unique: true });
export const ArchiveChunkSchema = new Schema({
  orderId: Schema.Types.ObjectId, version: Number, fileId: String, seq: Number, data: Buffer,
}, { ...options, collection: CHUNKS });
ArchiveChunkSchema.index({ orderId: 1, version: 1, fileId: 1, seq: 1 }, { unique: true });
