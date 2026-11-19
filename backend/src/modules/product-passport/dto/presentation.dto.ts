import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { Equals, IsIn, IsMongoId, IsObject, IsOptional, ValidateIf } from 'class-validator';
import { PASSPORT_VARIANTS, type PassportVariant } from '../passport-variants';

export class PassportTemplateQueryDto {
  @ApiPropertyOptional({ enum: PASSPORT_VARIANTS, default: 'short' })
  @ValidateIf((_, v) => v !== undefined)
  @IsIn(PASSPORT_VARIANTS)
  variant?: PassportVariant;
}

export class PassportPresentationDto extends PassportTemplateQueryDto {
  @ApiPropertyOptional({ enum: [1] })
  @ValidateIf((_, v) => v !== undefined)
  @Equals(1)
  presentationVersion?: 1;
}

export class PassportOrderQueryDto extends PassportPresentationDto {
  @Type(() => Number)
  declare presentationVersion?: 1;

  @ApiPropertyOptional()
  @IsOptional()
  @IsMongoId()
  supplierOrgId?: string;
}

export class PatchPassportTemplateDto {
  @IsObject()
  changes!: Record<string, unknown>;

  @IsObject()
  expected!: Record<string, unknown>;
}
