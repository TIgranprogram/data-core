import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNumber, IsOptional, Matches, Max, Min } from 'class-validator';

/** Пустая строка сбрасывает поле. Нет ключа в теле — не трогаем (undefined остаётся). */
const empty = ({ value }: { value: unknown }) => (value === '' ? null : value);
const num = ({ value }: { value: unknown }) => {
  if (value === undefined) return undefined;
  if (value === '' || value === null) return null;
  const n = typeof value === 'number' ? value : Number(String(value).replace(',', '.'));
  return Number.isFinite(n) ? n : value;
};

/** Все поля необязательны. null или пустая строка — сбросить (цвет или отступ). */
export class UpdatePassportLookDto {
  @ApiPropertyOptional({ description: '#RRGGBB; пусто — чёрные линии' })
  @IsOptional() @Transform(empty) @Matches(/^#[0-9a-fA-F]{6}$/, { message: 'Цвет — в виде #RRGGBB' })
  color?: string | null;

  @ApiPropertyOptional({ description: 'Обложка: отступ сверху, мм' })
  @IsOptional() @Transform(num) @IsNumber() @Min(0) @Max(40)
  coverTop?: number | null;
  @ApiPropertyOptional() @IsOptional() @Transform(num) @IsNumber() @Min(0) @Max(40)
  coverRight?: number | null;
  @ApiPropertyOptional() @IsOptional() @Transform(num) @IsNumber() @Min(0) @Max(40)
  coverBottom?: number | null;
  @ApiPropertyOptional() @IsOptional() @Transform(num) @IsNumber() @Min(0) @Max(40)
  coverLeft?: number | null;

  @ApiPropertyOptional({ description: 'Страницы: отступ сверху, мм' })
  @IsOptional() @Transform(num) @IsNumber() @Min(0) @Max(40)
  pageTop?: number | null;
  @ApiPropertyOptional() @IsOptional() @Transform(num) @IsNumber() @Min(0) @Max(40)
  pageRight?: number | null;
  @ApiPropertyOptional() @IsOptional() @Transform(num) @IsNumber() @Min(0) @Max(40)
  pageBottom?: number | null;
  @ApiPropertyOptional() @IsOptional() @Transform(num) @IsNumber() @Min(0) @Max(40)
  pageLeft?: number | null;
}
