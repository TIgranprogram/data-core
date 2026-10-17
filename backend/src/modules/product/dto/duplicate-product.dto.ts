import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Length } from 'class-validator';

/** Only identity/passport overrides are accepted; source/system fields are never caller-controlled. */
export class DuplicateProductDto {
  @ApiPropertyOptional({ description: 'Новое название копии' })
  @IsOptional()
  @IsString()
  @Length(0, 256)
  name?: string;

  @ApiPropertyOptional({ description: 'Новое описание копии' })
  @IsOptional()
  @IsString()
  @Length(0, 4000)
  description?: string;

  @ApiPropertyOptional({ description: 'Новая единица измерения копии' })
  @IsOptional()
  @IsString()
  @Length(1, 16)
  unit?: string;

  @ApiPropertyOptional({ description: 'Явно заданный свободный артикул копии' })
  @IsOptional()
  @IsString()
  @Length(1, 64)
  sku?: string;
}
