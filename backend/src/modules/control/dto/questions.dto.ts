import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsObject, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/** Тело `POST /api/control/questions`: вопрос от ИИ или скрипта. Тип из реестра; параметры проверяет сервер. */
export class CreateQuestionDto {
  @ApiProperty({ example: 'merge_partners', description: 'merge_partners | merge_dict_values | restore_trash | free_text' })
  @IsString() @MaxLength(40)
  type!: string;

  @ApiPropertyOptional({ description: 'Кто прислал (для лимита 20 в сутки); по умолчанию — имя ключа' })
  @IsOptional() @IsString() @MaxLength(60)
  sourceName?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80)
  runId?: string;

  @ApiPropertyOptional({ enum: ['low', 'medium', 'high'] }) @IsOptional() @IsIn(['low', 'medium', 'high'])
  severity?: 'low' | 'medium' | 'high';

  @ApiPropertyOptional({ description: 'Параметры типа: fromId/intoId (контрагенты, значения), dict, id, target = partner|dict' })
  @IsOptional() @IsObject()
  params?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Текст вопроса (обязателен для free_text; для остальных типов пишет сервер)' })
  @IsOptional() @IsString() @MaxLength(600)
  what?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(600)
  need?: string;

  @ApiPropertyOptional({ description: 'Совет: почему помощник так считает' })
  @IsOptional() @IsString() @MaxLength(600)
  advice?: string;

  @ApiPropertyOptional({ description: 'Для free_text: что считать «тем же вопросом» (повтор = count++)' })
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true })
  subjectIds?: string[];
}

export class PreviewDto {
  @ApiPropertyOptional({ description: 'Какой ответ смотреть; по умолчанию — первый с действием' })
  @IsOptional() @IsString() @MaxLength(40)
  optionCode?: string;
}

/** Тело `POST /api/control/questions/:id/answer`. Кнопка шлёт только код ответа; параметры сервер берёт из записи. */
export class AnswerDto {
  @ApiProperty() @IsString() @MaxLength(40)
  optionCode!: string;

  @ApiPropertyOptional({ description: 'Хеш плана из предпросмотра (обязателен для действий)' })
  @IsOptional() @IsString() @MaxLength(64)
  planHash?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(600)
  comment?: string;

  @ApiPropertyOptional({ example: '2026-11-15', description: 'Для «Отложить до даты»' })
  @IsOptional() @IsString() @MaxLength(40)
  snoozeUntil?: string;
}

export class QuestionsQuery {
  @ApiPropertyOptional({ description: 'open | executing | done | failed | waiting_agent | snoozed | dismissed | resolved_auto | expired (можно через запятую)' })
  @IsOptional() @IsString() @MaxLength(200)
  status?: string;

  @ApiPropertyOptional({ enum: ['low', 'medium', 'high'] }) @IsOptional() @IsString() @MaxLength(10)
  severity?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40)
  type?: string;

  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page?: number;

  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200)
  limit?: number;
}

export class EventsQuery {
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page?: number;

  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200)
  limit?: number;
}
