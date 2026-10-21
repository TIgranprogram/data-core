import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsMongoId,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Min,
  ValidateNested,
} from 'class-validator';
import { MATERIAL_KINDS, type MaterialKind } from '../material.schema';

export { MATERIAL_KINDS };

const DIMENSION_TYPES = [
  'length',
  'width',
  'height',
  'thickness',
  'diameter',
  'depth',
] as const;

export class DimensionDto {
  @ApiProperty({ enum: DIMENSION_TYPES, description: 'Тип размера' })
  @IsIn(DIMENSION_TYPES, {
    message: `type должен быть одним из: ${DIMENSION_TYPES.join(', ')}`,
  })
  type!: (typeof DIMENSION_TYPES)[number];

  @ApiProperty({ description: 'Значение размера' })
  @IsNumber()
  @Min(0)
  value!: number;

  @ApiPropertyOptional({ description: 'Неизменяемый размер' })
  @IsOptional()
  @IsBoolean()
  isImmutable?: boolean;
}

export class CreateMaterialDto {
  @ApiProperty({ example: 'Стекло 4мм', description: 'Название материала' })
  @IsString()
  @Length(1, 256)
  name!: string;

  @ApiProperty({ example: 'STK-004', description: 'Артикул материала' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString({ message: 'Артикул материала обязателен' })
  @Length(1, 64, { message: 'Артикул материала: от 1 до 64 символов' })
  article!: string;

  @ApiPropertyOptional({ example: 'M-0001', description: 'Внутренний код материала (уникальный, поисковый)' })
  @IsOptional()
  @IsString()
  @Length(0, 64)
  sku?: string;

  @ApiPropertyOptional({ enum: MATERIAL_KINDS, description: 'Тип каталожной позиции' })
  @IsOptional()
  @IsIn(MATERIAL_KINDS)
  materialKind?: MaterialKind;

  @ApiPropertyOptional({ description: 'Сортамент или тип позиции (например, труба/лист)' })
  @IsOptional()
  @IsString()
  @Length(0, 256)
  assortment?: string;

  @ApiPropertyOptional({ description: 'Нормативный стандарт: ГОСТ, ASTM и т.п.' })
  @IsOptional()
  @IsString()
  @Length(0, 256)
  standardRef?: string;

  @ApiPropertyOptional({ description: 'Марка материала: Ст3, AISI 304 и т.п.' })
  @IsOptional()
  @IsString()
  @Length(0, 256)
  materialGrade?: string;

  @ApiPropertyOptional({ example: 1.5, description: 'Масса в килограммах' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  weightKg?: number;

  @ApiProperty({ example: 'м2', description: 'Единица измерения' })
  @IsString()
  @Length(1, 32)
  unit!: string;

  @ApiPropertyOptional({ description: 'ID категории' })
  @IsOptional()
  @IsMongoId()
  categoryId?: string;

  @ApiPropertyOptional({ description: 'Описание материала' })
  @IsOptional()
  @IsString()
  @Length(0, 2000)
  description?: string;

  @ApiPropertyOptional({ description: 'Цена за единицу (RUB)' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  pricePerUnit?: number;

  @ApiPropertyOptional({ description: 'Количество на складе' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  stockQty?: number;

  @ApiPropertyOptional({ type: [DimensionDto], description: 'Размеры материала' })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DimensionDto)
  dimensions?: DimensionDto[];

  @ApiPropertyOptional({ type: [String], description: 'Цвета, доступные для заказа у материала' })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  colors?: string[];

  @ApiPropertyOptional({ type: [String], description: 'ID фотографий' })
  @IsOptional()
  @IsArray()
  @IsMongoId({ each: true })
  photoIds?: string[];

  @ApiPropertyOptional({ description: 'ID основного фото' })
  @IsOptional()
  @IsMongoId()
  mainPhotoId?: string;

  @ApiPropertyOptional({ description: 'ID поставщика' })
  @IsOptional()
  @IsMongoId()
  supplierId?: string;

  @ApiPropertyOptional({ description: 'Заметки' })
  @IsOptional()
  @IsString()
  @Length(0, 2000)
  notes?: string;
}
