import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type PdmImportDocument = HydratedDocument<PdmImport>;
export const PDM_IMPORT_STATUSES = ['planned', 'applied'] as const;
export type PdmImportStatus = (typeof PDM_IMPORT_STATUSES)[number];

/** Найденная при предпросмотре запись: коллекция, номер, `updatedAt` (проверка «данные изменились» при загрузке). */
export interface PdmFound { coll: 'materials' | 'productmodules' | 'products'; id: Types.ObjectId; updatedAt: Date | null }

/**
 * C057: журнал «Загрузка из PDM». Одна запись = один предпросмотр (план) и, если применён, итог.
 * Хранит дерево (≤ 2 МБ), хэш дерева, версии найденных записей, решения человека.
 */
@Schema({ collection: 'pdmimports', timestamps: true })
export class PdmImport {
  @Prop({ type: String, required: true }) treeHash!: string;
  @Prop({ type: String, enum: PDM_IMPORT_STATUSES, default: 'planned', index: true }) status!: PdmImportStatus;
  @Prop({ type: String, required: true }) root!: string;
  /** Дерево pdm-tree/1 как пришло. */
  @Prop({ type: Object, required: true }) tree!: Record<string, unknown>;
  /** Что делать с каждым обозначением (create | link | suggest | conflict | same), сортаменты, blockers, needFiles. */
  @Prop({ type: Object, required: true }) plan!: Record<string, unknown>;
  @Prop({ type: [Object], default: [] }) found!: PdmFound[];
  @Prop({ type: Object }) decisions?: Record<string, unknown>;
  /** Итог загрузки: created, linked, updated, skipped, needFiles. */
  @Prop({ type: Object }) result?: Record<string, unknown>;
  /** Кому принадлежит файл: обозначение → { kind, id } (заполняется при загрузке). */
  @Prop({ type: Object }) owners?: Record<string, { kind: string; id: Types.ObjectId }>;
  @Prop({ type: Types.ObjectId }) createdBy?: Types.ObjectId;
  @Prop({ type: Types.ObjectId }) appliedBy?: Types.ObjectId;
  @Prop({ type: Date }) appliedAt?: Date;
  @Prop({ type: Types.ObjectId, index: true, sparse: true }) organizationId?: Types.ObjectId;
  @Prop({ type: Date, default: null }) deletedAt?: Date | null;
}

export const PdmImportSchema = SchemaFactory.createForClass(PdmImport);
PdmImportSchema.index({ organizationId: 1, treeHash: 1, createdAt: -1 });
