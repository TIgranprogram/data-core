import { ApiProperty } from '@nestjs/swagger';
import { IsMongoId, IsString, MaxLength, MinLength } from 'class-validator';
import { MESSAGE_MAX } from '../message.schema';

export class SendMessageDto {
  @ApiProperty({ description: 'id получателя (активный пользователь)' })
  @IsMongoId({ message: 'Некорректный получатель' })
  toUserId!: string;

  @ApiProperty({ maxLength: MESSAGE_MAX })
  @IsString({ message: 'Текст сообщения обязателен' })
  @MinLength(1, { message: 'Напишите текст сообщения' })
  @MaxLength(MESSAGE_MAX, { message: `Сообщение — не больше ${MESSAGE_MAX} знаков` })
  text!: string;
}
