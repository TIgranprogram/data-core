import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsMongoId,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

/** HTML/select empty string → null so @IsOptional skips MongoId check. */
const emptyStringToNull = ({ value }: { value: unknown }) =>
  value === '' ? null : value;

class ProductDimensionsDto {
  @ApiPropertyOptional({ description: 'Длина' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'Длина должна быть числом' })
  @Min(0, { message: 'Длина не может быть отрицательной' })
  length?: number;

  @ApiPropertyOptional({ description: 'Ширина' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'Ширина должна быть числом' })
  @Min(0, { message: 'Ширина не может быть отрицательной' })
  width?: number;

  @ApiPropertyOptional({ description: 'Высота' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'Высота должна быть числом' })
  @Min(0, { message: 'Высота не может быть отрицательной' })
  height?: number;

  @ApiPropertyOptional({ description: 'Единица измерения' })
  @IsOptional()
  @IsString()
  unit?: string;
}

export class CreateProductDto {
  @ApiPropertyOptional({ example: 'Окно ПВХ 1200x1400', description: 'Название продукта' })
  @IsOptional()
  @IsString()
  @Length(0, 256, { message: 'Название: не более 256 символов' })
  name?: string;

  @ApiProperty({ example: 'WIN-PVH-1214', description: 'Артикул изделия' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString({ message: 'Артикул изделия обязателен' })
  @Length(1, 64, { message: 'Артикул изделия: от 1 до 64 символов' })
  sku!: string;

  @ApiProperty({ enum: ['good', 'service', 'work'], description: 'Тип: товар/услуга/работа' })
  @IsIn(['good', 'service', 'work'], { message: 'Недопустимый тип изделия' })
  kind!: 'good' | 'service' | 'work';

  @ApiProperty({ example: 'шт', description: 'Единица измерения' })
  @IsString({ message: 'Единица измерения обязательна' })
  @Length(1, 16)
  unit!: string;

  @ApiPropertyOptional({ description: 'ID категории (null = без категории)' })
  @Transform(emptyStringToNull)
  @IsOptional()
  @IsMongoId({ message: 'Некорректная категория' })
  categoryId?: string | null;

  @ApiPropertyOptional({ description: 'Подкатегория' })
  @IsOptional()
  @IsString()
  @Length(0, 64)
  subcategory?: string;

  @ApiPropertyOptional({ enum: ['new', 'active', 'archived', 'draft'], description: 'Статус' })
  @IsOptional()
  @IsIn(['new', 'active', 'archived', 'draft'], { message: 'Недопустимый статус' })
  status?: 'new' | 'active' | 'archived' | 'draft';

  @ApiPropertyOptional({ description: 'Цена по прайсу' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'Цена должна быть числом' })
  @Min(0, { message: 'Цена не может быть отрицательной' })
  listPrice?: number;

  @ApiPropertyOptional({ description: 'Базовая цена' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'Базовая цена должна быть числом' })
  @Min(0)
  basePrice?: number;

  @ApiPropertyOptional({ description: 'Себестоимость' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'Себестоимость должна быть числом' })
  @Min(0)
  costPrice?: number;

  @ApiPropertyOptional({ description: 'Наценка по умолчанию (%)' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1000)
  defaultMarkupPercent?: number;

  @ApiPropertyOptional({ description: 'Количество на складе' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  stockQty?: number;

  @ApiPropertyOptional({ description: 'Описание продукта' })
  @IsOptional()
  @IsString()
  @Length(0, 4000)
  description?: string;

  @ApiPropertyOptional({ description: 'Заметки' })
  @IsOptional()
  @IsString()
  @Length(0, 4000)
  notes?: string;

  @ApiPropertyOptional({ type: [String], description: 'ID фотографий' })
  @IsOptional()
  @IsArray()
  @IsMongoId({ each: true, message: 'Некорректный ID фото' })
  photoIds?: string[];

  @ApiPropertyOptional({ description: 'Главное фото (ID из photoIds; null = авто)' })
  @Transform(emptyStringToNull)
  @IsOptional()
  @IsMongoId({ message: 'Некорректный ID главного фото' })
  mainPhotoId?: string | null;

  @ApiPropertyOptional({ type: ProductDimensionsDto, description: 'Размеры продукта' })
  @IsOptional()
  @ValidateNested()
  @Type(() => ProductDimensionsDto)
  dimensions?: ProductDimensionsDto;

  @ApiPropertyOptional({ description: 'Вес (кг)' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'Вес должен быть числом' })
  @Min(0)
  weightKg?: number;

  @ApiPropertyOptional({ description: 'Код RAL (null = без цвета)' })
  @Transform(emptyStringToNull)
  @IsOptional()
  @IsString()
  @Length(0, 64)
  ralCode?: string | null;

  @ApiPropertyOptional({ description: 'Есть ли паспорт' })
  @IsOptional()
  @IsBoolean()
  hasPassport?: boolean;

  @ApiPropertyOptional({ description: 'Есть ли чертёж' })
  @IsOptional()
  @IsBoolean()
  hasDrawing?: boolean;

  @ApiPropertyOptional({ description: 'Активен ли продукт' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ description: 'Назначение' })
  @IsOptional()
  @IsString()
  @Length(0, 256)
  purpose?: string;

  @ApiPropertyOptional({ description: 'Установка' })
  @IsOptional()
  @IsString()
  @Length(0, 256)
  installation?: string;

  @ApiPropertyOptional({ type: Object, description: 'EAV: { attributeName: value }' })
  @IsOptional()
  @IsObject()
  attributes?: Record<string, unknown>;
}
