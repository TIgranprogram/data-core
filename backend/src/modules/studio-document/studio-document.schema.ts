import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type StudioDocumentStatus = 'draft' | 'frozen' | 'final';

export type StudioDocumentDocument = HydratedDocument<StudioDocument>;

@Schema({ collection: 'studio_documents', timestamps: true })
export class StudioDocument {
  @Prop({ required: true, index: true })
  name!: string;

  @Prop({ type: Types.ObjectId, ref: 'Organization', required: true, index: true })
  organizationId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'DocType', index: true })
  docTypeId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Quotation', index: true })
  linkedQuotationId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'DocumentTemplate', index: true })
  sourceTemplateId?: Types.ObjectId;

  @Prop({ enum: ['A3', 'A4', 'A5'], default: 'A4' })
  pageSize!: string;

  @Prop({ enum: ['portrait', 'landscape'], default: 'portrait' })
  orientation!: 'portrait' | 'landscape';

  @Prop({ type: [String], default: [] })
  backgroundImage!: string[];

  @Prop({ default: -1 })
  defaultBackgroundIndex!: number;

  @Prop({ type: [Number], default: [] })
  backgroundPageIndices!: number[];

  @Prop({ default: 0.3 })
  backgroundOpacity!: number;

  @Prop({
    type: {
      top: { type: Number, min: 0, max: 50, default: 0 },
      right: { type: Number, min: 0, max: 50, default: 0 },
      bottom: { type: Number, min: 0, max: 50, default: 0 },
      left: { type: Number, min: 0, max: 50, default: 0 },
    },
    default: { top: 0, right: 0, bottom: 0, left: 0 },
  })
  pageMargins!: { top: number; right: number; bottom: number; left: number };

  @Prop({
    type: {
      rowsFirstPage: { type: Number, min: 0, max: 200, default: 0 },
      rowsNextPage: { type: Number, min: 0, max: 200, default: 0 },
    },
    default: { rowsFirstPage: 0, rowsNextPage: 0 },
  })
  sheetLayout!: { rowsFirstPage: number; rowsNextPage: number };

  @Prop({ default: false })
  pageNumbering!: boolean;

  @Prop({ default: 1, min: 1 })
  manualPageCount!: number;

  @Prop({ type: Object, default: {} })
  context!: Record<string, unknown>;

  @Prop({ type: [Object], default: [] })
  dataAnchors!: Record<string, unknown>[];

  @Prop({ type: [Object], default: [] })
  dataSets!: Record<string, unknown>[];

  @Prop({
    type: String,
    enum: ['draft', 'frozen', 'final'],
    default: 'draft',
    index: true,
  })
  status!: StudioDocumentStatus;

  @Prop({ default: 1, min: 1 })
  revision!: number;

  @Prop({ default: 1 })
  schemaVersion!: number;

  @Prop({ type: Types.ObjectId, ref: 'User', index: true })
  createdBy?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', index: true })
  updatedBy?: Types.ObjectId;

  @Prop({ type: Date, default: null, index: true })
  deletedAt?: Date | null;
}

export const StudioDocumentSchema = SchemaFactory.createForClass(StudioDocument);
StudioDocumentSchema.index({ organizationId: 1, status: 1 });
StudioDocumentSchema.index({ organizationId: 1, updatedAt: -1 });
