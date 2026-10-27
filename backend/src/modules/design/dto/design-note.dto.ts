import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsIn, IsMongoId, IsOptional, IsString, Length } from 'class-validator';
import { NOTE_KINDS, NOTE_SOURCES, type NoteKind, type NoteSource } from '../design-note.schema';

/**
 * Новая запись обсуждения. Поля `source`, `authorName`, `createdAt`, `externalId` — для переноса из YouGile:
 * действуют только у admin (JWT или машинный ключ `kppd_` админа), у остальных игнорируются.
 */
export class DesignNoteDto {
  @ApiPropertyOptional({ enum: NOTE_KINDS, description: 'comment (по умолчанию) | question — вопрос менеджеру' }) @IsOptional() @IsIn(NOTE_KINDS as unknown as string[]) kind?: NoteKind;
  @ApiProperty({ description: 'Текст, до 4000 знаков' }) @IsString() @Length(1, 4000) text!: string;
  @ApiPropertyOptional({ description: 'Ответ на вопрос (id записи kind=question этой же задачи); снимает «Требует ответа»' }) @IsOptional() @IsMongoId() replyTo?: string;
  @ApiPropertyOptional({ enum: NOTE_SOURCES, description: 'Импорт, только admin: app | coordinator | yougile' }) @IsOptional() @IsIn(NOTE_SOURCES as unknown as string[]) source?: NoteSource;
  @ApiPropertyOptional({ description: 'Импорт, только admin: имя автора, если его нет среди пользователей' }) @IsOptional() @IsString() @Length(1, 120) authorName?: string;
  @ApiPropertyOptional({ description: 'Импорт, только admin: время записи (ISO)' }) @IsOptional() @IsDateString() createdAt?: string;
  @ApiPropertyOptional({ description: 'Импорт, только admin: id сообщения в YouGile; повтор с тем же id вернёт уже созданную запись' }) @IsOptional() @IsString() @Length(1, 100) externalId?: string;
}

export class DesignNoteEditDto {
  @ApiProperty() @IsString() @Length(1, 4000) text!: string;
}
