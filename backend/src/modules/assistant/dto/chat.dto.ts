import { Type } from 'class-transformer';
import { IsIn, IsOptional, IsString, Matches, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { MESSAGE_MAX } from '../assistant.config';

/** Где пользователь сейчас: раздел и (необязательно) открытая запись. Только для подсказки модели. */
export class ChatContextDto {
  @IsString() @Matches(/^[a-z]{1,30}$/, { message: 'Раздел — латинское имя' })
  section!: string;

  @IsOptional() @IsString() @Matches(/^[\w-]{1,40}$/, { message: 'Некорректный id записи' })
  id?: string;
}

export class ChatDto {
  @IsString() @MinLength(1, { message: 'Напишите вопрос' }) @MaxLength(MESSAGE_MAX, { message: 'Вопрос слишком длинный' })
  message!: string;

  @IsOptional() @IsIn(['fast', 'normal', 'smart'], { message: 'Модель: fast, normal или smart' })
  model?: 'fast' | 'normal' | 'smart';

  @IsOptional() @ValidateNested() @Type(() => ChatContextDto)
  context?: ChatContextDto;
}
