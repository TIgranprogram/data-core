import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsString, Length } from 'class-validator';

/** Тело действий рабочего. Все поля необязательны; `reason` обязателен для «Отложить» и «Проблема» (проверяет сервис). */
export class MyTaskActionDto {
  @ApiPropertyOptional({ description: 'Причина: нет материала, нет чертежа, ждёт другого участка, поломка, другое + текст' }) @IsOptional() @IsString() @Length(0, 200) reason?: string;
  @ApiPropertyOptional({ description: 'Отложить до (ГГГГ-ММ-ДД); пусто — завтра' }) @IsOptional() @IsDateString() until?: string;
  @ApiPropertyOptional({ description: 'Время нажатия на телефоне (работа без связи); не из будущего и не старше суток' }) @IsOptional() @IsDateString() clientTime?: string;
}
