import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsMongoId, IsNumber, IsOptional, IsString, MaxLength, Min, ValidateNested } from 'class-validator';

/** Правка позиции каталога (панель строки). materialId: null — снять связь. */
export class CatalogItemPatchDto {
  @IsOptional() @IsString() @MaxLength(300) name?: string;
  @IsOptional() @IsString() @MaxLength(40) unit?: string;
  @IsOptional() @IsString() @MaxLength(100) color?: string;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
  @IsOptional() @IsString() @MaxLength(100) optGroup?: string;
  @IsOptional() @IsNumber() @Min(0) price?: number;
  @IsOptional() @IsBoolean() inStock?: boolean;
  @IsOptional() @IsMongoId() materialId?: string | null;
}

/** Создание позиции вручную (POST) и строка массовой записи (скрипты). */
export class CatalogItemDto {
  @IsMongoId() supplierId!: string;
  @IsOptional() @IsString() @MaxLength(100) article?: string;
  @IsString() @MaxLength(300) name!: string;
  @IsOptional() @IsString() @MaxLength(100) color?: string;
  @IsOptional() @IsString() @MaxLength(40) unit?: string;
  @IsOptional() @IsNumber() @Min(0) price?: number;
  @IsOptional() @IsString() priceDate?: string;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
  @IsOptional() @IsMongoId() materialId?: string;
  @IsOptional() @IsIn(['request', 'stock', 'manual']) source?: 'request' | 'stock' | 'manual';
}

export class CatalogBulkDto {
  @IsArray() @ArrayMaxSize(1000) @ValidateNested({ each: true }) @Type(() => CatalogItemDto)
  items!: CatalogItemDto[];
}
