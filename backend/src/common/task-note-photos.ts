import { BadRequestException } from '@nestjs/common';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayUnique, IsArray, IsMongoId, IsOptional, IsString, MaxLength } from 'class-validator';
import type { Connection, Types } from 'mongoose';
import { oid } from './list-query';
import { loadPhotos } from './photos';

export const NOTE_PHOTO_LIMIT = 5;

export class TaskNoteContentDto {
  @ApiPropertyOptional({ description: 'Текст сообщения, до 4000 знаков' })
  @IsOptional() @IsString() @MaxLength(4000) text?: string;

  @ApiPropertyOptional({ type: [String], maxItems: NOTE_PHOTO_LIMIT, description: 'Фото из POST /api/photos/upload' })
  @IsOptional() @IsArray() @ArrayMaxSize(NOTE_PHOTO_LIMIT) @ArrayUnique() @IsMongoId({ each: true }) photoIds?: string[];
}

type Db = NonNullable<Connection['db']>;

export async function notePhotoIds(db: Db, raw: string[] = []) {
  const ids = raw.map((id) => oid(id, 'фото'));
  if (!ids.length) return ids;
  const found = await db.collection('photos').countDocuments({
    _id: { $in: ids }, parentPhotoId: null, deletedAt: null, mimeType: /^image\//,
  });
  if (found !== ids.length) throw new BadRequestException('Не удалось найти все фотографии сообщения');
  return ids;
}

export function loadNotePhotos(db: Db, notes: Array<{ photoIds?: unknown }>) {
  const ids = notes.flatMap((note) => Array.isArray(note.photoIds) ? note.photoIds as Types.ObjectId[] : []);
  return loadPhotos(db, [...new Map(ids.map((id) => [String(id), id])).values()]);
}
