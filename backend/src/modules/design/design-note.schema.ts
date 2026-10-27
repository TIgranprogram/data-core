import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type DesignNoteDocument = HydratedDocument<DesignNote>;

/** Вид записи обсуждения (этап 1): комментарий или вопрос менеджеру. Чек-лист и напоминания — позже. */
export const NOTE_KINDS = ['comment', 'question'] as const;
export type NoteKind = (typeof NOTE_KINDS)[number];
/** Откуда запись: сайт, координатор (ключ `kppd_`), перенос из YouGile. */
export const NOTE_SOURCES = ['app', 'coordinator', 'yougile'] as const;
export type NoteSource = (typeof NOTE_SOURCES)[number];

/**
 * Обсуждение задачи проектирования (`designnotes`, только data-core; CRM не читает).
 * Вопрос (`question`) держит `needsAnswer`, пока не придёт ответ — комментарий с `replyTo` на него.
 * Импорт из YouGile: `source:'yougile'`, `authorName`, свой `createdAt`, `externalId` (unique sparse — повтор без дублей).
 */
@Schema({ timestamps: true, collection: 'designnotes' })
export class DesignNote {
  @Prop({ type: Types.ObjectId, required: true }) taskId!: Types.ObjectId;
  @Prop({ type: Types.ObjectId }) orderId?: Types.ObjectId;
  @Prop({ type: Types.ObjectId }) incomeId?: Types.ObjectId;
  @Prop({ type: String, enum: NOTE_KINDS, default: 'comment' }) kind!: NoteKind;
  @Prop({ type: String, required: true, trim: true, maxlength: 4000 }) text!: string;
  @Prop({ type: Types.ObjectId }) authorId?: Types.ObjectId;
  /** Имя автора, если его нет среди пользователей сайта (перенос из YouGile). */
  @Prop({ type: String, trim: true, maxlength: 120 }) authorName?: string;
  @Prop({ type: Types.ObjectId }) replyTo?: Types.ObjectId;
  @Prop({ type: Boolean, default: false }) needsAnswer!: boolean;
  @Prop({ type: Date }) answeredAt?: Date;
  @Prop({ type: Types.ObjectId }) answeredBy?: Types.ObjectId;
  @Prop({ type: String, enum: NOTE_SOURCES, default: 'app' }) source!: NoteSource;
  @Prop({ type: String, trim: true, maxlength: 100 }) externalId?: string;
  @Prop({ type: Date, default: null }) deletedAt?: Date | null;
}

export const DesignNoteSchema = SchemaFactory.createForClass(DesignNote);
DesignNoteSchema.index({ taskId: 1, createdAt: 1 });
// открытые вопросы (partial: в 4.4 допустимо только равенство)
DesignNoteSchema.index({ needsAnswer: 1, deletedAt: 1 }, { partialFilterExpression: { needsAnswer: true } });
DesignNoteSchema.index({ externalId: 1 }, { unique: true, sparse: true });
