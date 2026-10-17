import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsNumber, IsOptional, IsString, Length, Min } from 'class-validator';

export class UpdateDictionaryLabelDto {
  @ApiPropertyOptional({ description: 'Отображаемое название' })
  @IsOptional()
  @IsString()
  @Length(1, 120)
  label?: string;

  @ApiPropertyOptional({ description: 'Порядок сортировки' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  sortOrder?: number;

  @ApiPropertyOptional({ description: 'Доступность в активных списках' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
