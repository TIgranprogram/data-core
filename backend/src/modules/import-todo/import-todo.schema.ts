import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type ImportTodoDocument = HydratedDocument<ImportTodo>;

export const IMPORT_TODO_STATUSES = ['open', 'done'] as const;
export type ImportTodoStatus = (typeof IMPORT_TODO_STATUSES)[number];

/**
 * TZD-29 — manager "finish" list: что доделать после импорта
 * (сомнительные строки, черновики шаблонов). Виден менеджеру в вебе
 * (/import-todos) и создаётся агентом через MCP. Не email/push.
 */
@Schema({ collection: 'import_todos', timestamps: true })
export class ImportTodo {
  @Prop({ required: true, trim: true, maxlength: 256 })
  title!: string;

  @Prop({ maxlength: 2000 })
  body?: string;

  @Prop({ maxlength: 1024 })
  href?: string;

  @Prop({ type: Types.ObjectId, ref: 'ImportTask', index: true })
  importTaskId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'DocumentTemplate', index: true })
  templateId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Organization', index: true })
  organizationId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  createdByUserId!: Types.ObjectId;

  @Prop({ required: true, enum: IMPORT_TODO_STATUSES, default: 'open', index: true })
  status!: ImportTodoStatus;

  /** TZ-CORE-302: soft-delete timestamp; null = active. */
  @Prop({ type: Date, default: null, index: true })
  deletedAt?: Date | null;
}

export const ImportTodoSchema = SchemaFactory.createForClass(ImportTodo);
ImportTodoSchema.index({ organizationId: 1, status: 1, createdAt: -1 });
