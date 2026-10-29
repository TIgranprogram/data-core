import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/** ПН: какие № получит следующий выпущенный паспорт (паспорт и/или изделие). */
export class NextPassportNumberDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 999999999 }) @IsOptional() @IsInt() @Min(1) @Max(999999999) next?: number;
  @ApiPropertyOptional({ minimum: 1, maximum: 999999999 }) @IsOptional() @IsInt() @Min(1) @Max(999999999) nextProductCode?: number;
}
