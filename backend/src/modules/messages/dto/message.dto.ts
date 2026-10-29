import { ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsBoolean, IsMongoId, IsOptional, IsString, MaxLength } from 'class-validator';
import { MESSAGE_MAX } from '../message.schema';

export class SendMessageDto {
  @ApiPropertyOptional({ description: 'id получателя (активный пользователь); не нужен при toAll' })
  @IsOptional()
  @IsMongoId({ message: 'Некорректный получатель' })
  toUserId?: string;

  @ApiPropertyOptional({ description: 'Написать всем сотрудникам (toUserId не нужен)' })
  @IsOptional()
  @IsBoolean()
  toAll?: boolean;

  @ApiPropertyOptional({ maxLength: MESSAGE_MAX, description: 'Текст; необязателен, если есть фото' })
  @IsOptional()
  @IsString({ message: 'Текст сообщения должен быть строкой' })
  @MaxLength(MESSAGE_MAX, { message: `Сообщение — не больше ${MESSAGE_MAX} знаков` })
  text?: string;

  @ApiPropertyOptional({ type: [String], description: 'id фото (после POST /photos/upload), до 10' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10, { message: 'Не больше 10 фото в сообщении' })
  @IsMongoId({ each: true, message: 'Некорректное фото' })
  photoIds?: string[];
}
