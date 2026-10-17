import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export const IMPORT_MAPPING_TARGETS = [
  'material',
  'product',
  'module',
  'counterparty',
] as const;
export type ImportMappingTarget = (typeof IMPORT_MAPPING_TARGETS)[number];

export interface ImportMappingTable {
  targetEntity: ImportMappingTarget;
  columnMap: Record<string, string | null>;
}

export type ImportMappingProfileDocument = HydratedDocument<ImportMappingProfile>;

@Schema({ softDelete: false,  collection: 'import_mapping_profiles', timestamps: true })
export class ImportMappingProfile {
  @Prop({ required: true, trim: true, index: true })
  name!: string;

  @Prop({ type: Types.ObjectId, required: true, index: true })
  organizationId!: Types.ObjectId;

  /** Легаси: одиночная таблица (старые клиенты). */
  @Prop({ type: Object, required: false })
  columnMap?: Record<string, string | null>;

  @Prop({ enum: IMPORT_MAPPING_TARGETS, default: 'material' })
  targetEntity?: ImportMappingTarget;

  /** Мульти-табличный профиль «метод приложения»: таблицы + поля каждой. */
  @Prop({ type: [Object], required: false, default: undefined })
  tables?: ImportMappingTable[];

  @Prop({ required: true, default: false, index: true })
  isDefault!: boolean;

  @Prop({ type: Types.ObjectId, required: true })
  createdByUserId!: Types.ObjectId;
}

export const ImportMappingProfileSchema = SchemaFactory.createForClass(ImportMappingProfile);
ImportMappingProfileSchema.index({ organizationId: 1, name: 1 }, { unique: true });
ImportMappingProfileSchema.index({ organizationId: 1, isDefault: 1 });
