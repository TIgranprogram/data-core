import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsObjectId } from '../../../common/decorators/is-object-id.decorator';

/**
 * TZ-WORKERS-301 — Find/query DTO for the workers list endpoint.
 *
 * Defaults/clamps (TZ-278 pattern): page ≥ 1, 1 ≤ limit ≤ 100.
 * `organizationId` НЕ принимается из клиента — область всегда берётся из
 * req.user (IDOR guard). Все поля опциональны.
 */
export class FindWorkersDto {
  @ApiPropertyOptional({ example: 1 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;

  @ApiPropertyOptional({ example: 20 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;

  @ApiPropertyOptional({ description: 'Поиск по lastName/firstName/email/phone' })
  @IsOptional() @IsString() search?: string;

  @ApiPropertyOptional({ description: 'Фильтр по активности' })
  @IsOptional() @Type(() => Boolean) @IsBoolean() isActive?: boolean;

  @ApiPropertyOptional({ description: 'Фильтр по фирме-поставщику' })
  @IsOptional() @IsObjectId() supplierId?: string;

  @ApiPropertyOptional({ description: 'Фильтр по виду работ (M2M)' })
  @IsOptional() @IsObjectId() workTypeId?: string;
}
