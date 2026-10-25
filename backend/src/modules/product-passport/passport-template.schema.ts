import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import type { TemplateSection, TemplateTable } from './passport-template.default';

export type PassportTemplateDocument = HydratedDocument<PassportTemplate>;

/**
 * «Шаблон паспорта» — типовые разделы 3–7 и таблицы (TASKS ПС.1). Каждая правка — новая версия
 * (старая остаётся с isActive=false — видно, по какому тексту выдан паспорт).
 */
@Schema({ collection: 'passporttemplates', timestamps: true, softDelete: false }) // версии не удаляются — старые isActive=false
export class PassportTemplate {
  @Prop({ required: true })
  version!: number;

  @Prop({ default: true, index: true })
  isActive!: boolean;

  @Prop({ type: Array, default: [] })
  sections!: TemplateSection[];

  @Prop({ type: Array, default: [] })
  tables!: TemplateTable[];

  /** Категория блока текста (ALL/DIO/DSP/TRN/WRK/BLG); нет поля = «Для всех» (БЗ-6 Э2b). */
  @Prop({ type: String })
  category?: string;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  updatedBy?: Types.ObjectId;
}

export const PassportTemplateSchema = SchemaFactory.createForClass(PassportTemplate);
