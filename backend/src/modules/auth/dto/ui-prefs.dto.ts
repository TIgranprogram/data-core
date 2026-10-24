import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/**
 * ШП-1 — PATCH /api/auth/me/prefs: ширины панелей «Рабочего места», px.
 * Все ключи необязательны, пишутся только присланные. Лишний ключ → 400
 * (глобальный ValidationPipe с forbidNonWhitelisted), строка вместо числа → 400.
 */
export class UiPrefsDto {
  @ApiPropertyOptional({ minimum: 200, maximum: 360, example: 248, description: 'Ширина левого меню' })
  @IsOptional()
  @IsInt()
  @Min(200)
  @Max(360)
  sidebarW?: number;

  @ApiPropertyOptional({ minimum: 360, maximum: 1100, example: 700, description: 'Ширина правой панели ввода' })
  @IsOptional()
  @IsInt()
  @Min(360)
  @Max(1100)
  detailW?: number;

  @ApiPropertyOptional({ minimum: 280, maximum: 700, example: 340, description: 'Ширина панели фильтров' })
  @IsOptional()
  @IsInt()
  @Min(280)
  @Max(700)
  filterW?: number;
}
