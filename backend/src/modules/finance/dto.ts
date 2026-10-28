import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsObject, IsOptional, IsString, Matches } from 'class-validator';

/** Старт учёта: с этой даты остаток = openingBalance (по названию нашей компании: { "СИЮ": 100000 }). */
export class SettingsDto {
  @ApiPropertyOptional({ description: 'ГГГГ-ММ-ДД; null или пусто — без старта учёта', nullable: true })
  @IsOptional() @IsString() @Matches(/^(\d{4}-\d{2}-\d{2})?$/, { message: 'Дата старта — ГГГГ-ММ-ДД' }) startDate?: string | null;
  @ApiPropertyOptional({ description: 'Остаток на счёте на дату старта по компаниям, ₽' })
  @IsOptional() @IsObject() openingBalance?: Record<string, number>;
}
