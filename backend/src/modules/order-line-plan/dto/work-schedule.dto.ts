import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsMongoId, IsOptional } from 'class-validator';

/** Фильтры Ганта `GET /work-schedule` (C041 Э2). */
export class ScheduleQueryDto {
  @ApiPropertyOptional({ description: 'Начало периода (ISO); по умолчанию — 14 дней назад' }) @IsOptional() @IsDateString() from?: string;
  @ApiPropertyOptional({ description: 'Конец периода (ISO); по умолчанию — начало + 75 дней, не длиннее года' }) @IsOptional() @IsDateString() to?: string;
  @ApiPropertyOptional({ description: 'Только шаги этого сотрудника' }) @IsOptional() @IsMongoId() personId?: string;
  @ApiPropertyOptional({ description: 'Только шаги позиций этого заказа' }) @IsOptional() @IsMongoId() orderId?: string;
  @ApiPropertyOptional({ description: 'Только шаги этой позиции' }) @IsOptional() @IsMongoId() incomeId?: string;
}
