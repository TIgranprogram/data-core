import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsMongoId, IsNumber, IsObject, IsOptional, IsString, Length, Min, ValidateNested } from 'class-validator';

class ModuleDimensionsDto {
  @ApiPropertyOptional({ description: 'Ширина' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  width?: number;

  @ApiPropertyOptional({ description: 'Высота' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  height?: number;

  @ApiPropertyOptional({ description: 'Глубина' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  depth?: number;

  @ApiPropertyOptional({ description: 'Единица измерения' })
  @IsOptional()
  @IsString()
  @Length(0, 32)
  unit?: string;
}

/** API contract for creating a module; article is the catalog identity. */
export class CreateProductModuleDto {
  @ApiProperty({ example: 'Каркас двери' })
  @IsString()
  @Length(1, 200)
  name!: string;

  @ApiProperty({ example: 'MOD-DOOR-001', description: 'Артикул модуля' })
  @IsString({ message: 'Артикул модуля обязателен' })
  @Length(1, 64, { message: 'Артикул модуля: от 1 до 64 символов' })
  article!: string;

  @ApiProperty({ description: 'ID категории (Category.type = module)' })
  @IsMongoId({ message: 'Категория модуля обязательна' })
  categoryId!: string;

  @ApiPropertyOptional({ type: ModuleDimensionsDto })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => ModuleDimensionsDto)
  dimensions?: ModuleDimensionsDto;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  weight?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  sortOrder?: number;

  @ApiPropertyOptional({ type: [Object] })
  @IsOptional()
  @IsArray()
  workTypes?: unknown[];

  @ApiPropertyOptional({ type: [Object] })
  @IsOptional()
  @IsArray()
  materials?: unknown[];

  @ApiPropertyOptional({ type: [String], description: 'ID фотографий модуля' })
  @IsOptional()
  @IsArray()
  @IsMongoId({ each: true, message: 'Некорректный ID фото' })
  photoIds?: string[];

  @ApiPropertyOptional({ description: 'Главное фото (ID из photoIds; null = авто)' })
  @IsOptional()
  @IsMongoId({ message: 'Некорректный ID главного фото' })
  mainPhotoId?: string | null;
}
