import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min, ValidateNested } from 'class-validator';

export class CatalogAppearanceValueDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(359)
  productHue?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(359)
  moduleHue?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(359)
  materialHue?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(359)
  materialRawHue?: number | null;
}

export class UpsertCatalogAppearanceDto {
  @ValidateNested()
  @Type(() => CatalogAppearanceValueDto)
  value!: CatalogAppearanceValueDto;
}
