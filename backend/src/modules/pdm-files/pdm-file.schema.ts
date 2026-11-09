import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type PdmFileDocument = HydratedDocument<PdmFile>;

export const PDM_OWNER_KINDS = ['product', 'module', 'material'] as const;
export type PdmOwnerKind = (typeof PDM_OWNER_KINDS)[number];

/** pdf — чертёж детали/модуля, dxf — развёртка, assembly — сборочный чертёж изделия (_SS), install — схема установки (_BSUP). */
export const PDM_DOC_KINDS = ['pdf', 'dxf', 'assembly', 'install'] as const;
export type PdmDocKind = (typeof PDM_DOC_KINDS)[number];

/**
 * C057: файл из PDM (PDF/DXF) с версиями. Один файл версии — одна запись; `isCurrent` у самой новой версии
 * по ключу (организация, обозначение, вид). Сам файл — `uploads/pdm/<обозначение>/v<версия>/<имя>`.
 */
@Schema({ collection: 'pdmfiles', timestamps: true })
export class PdmFile {
  @Prop({ type: String, enum: PDM_OWNER_KINDS, required: true }) ownerKind!: PdmOwnerKind;
  @Prop({ type: Types.ObjectId, required: true }) ownerId!: Types.ObjectId;
  /** Обозначение PDM (из имени файла) — то же, что `article` детали/модуля или `sku` изделия. */
  @Prop({ type: String, required: true }) designation!: string;
  @Prop({ type: String, enum: PDM_DOC_KINDS, required: true }) docKind!: PdmDocKind;
  @Prop({ type: String, required: true }) name!: string;
  @Prop({ type: Number }) pdmFileId?: number;
  @Prop({ type: Number, required: true, min: 0 }) pdmVersion!: number;
  @Prop({ type: String }) pdmState?: string;
  /** Когда файл изменён в PDM. */
  @Prop({ type: Date }) modified?: Date;
  @Prop({ type: String, required: true }) sha256!: string;
  @Prop({ type: Number, required: true }) size!: number;
  /** Относительно папки загрузок: `pdm/<обозначение>/v<версия>/<имя>`. */
  @Prop({ type: String, required: true }) path!: string;
  @Prop({ type: Boolean, default: true }) isCurrent!: boolean;
  @Prop({ type: Types.ObjectId, index: true, sparse: true }) organizationId?: Types.ObjectId;
  @Prop({ type: Date, default: null }) deletedAt?: Date | null;
}

export const PdmFileSchema = SchemaFactory.createForClass(PdmFile);
PdmFileSchema.index({ organizationId: 1, designation: 1, docKind: 1, pdmVersion: 1 }, { unique: true });
PdmFileSchema.index({ ownerKind: 1, ownerId: 1, isCurrent: 1 });
PdmFileSchema.index({ designation: 1, docKind: 1, sha256: 1 });
