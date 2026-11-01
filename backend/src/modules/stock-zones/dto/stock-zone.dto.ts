import { ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayUnique, IsArray, IsBoolean, IsInt, IsMongoId, IsOptional, IsString, Length, Max, Min } from 'class-validator';

export class CreateStockZoneDto {
  @IsString({ message: 'Название — текст' }) @Length(1, 80, { message: 'Название склада — от 1 до 80 символов' }) name!: string;

  @ApiPropertyOptional({ type: [String], description: 'Категории склада (type material); подкатегории входят сами' })
  @IsOptional() @IsArray() @ArrayMaxSize(200, { message: 'Категорий не больше 200' }) @ArrayUnique({ message: 'Категория указана дважды' }) @IsMongoId({ each: true, message: 'Некорректная категория' })
  categoryIds?: string[];

  @ApiPropertyOptional({ type: [String], description: 'Позиции, добавленные в склад поштучно (materials.id)' })
  @IsOptional() @IsArray() @ArrayMaxSize(2000, { message: 'Добавок не больше 2000' }) @ArrayUnique({ message: 'Позиция указана дважды' }) @IsMongoId({ each: true, message: 'Некорректная позиция' })
  includeMaterialIds?: string[];

  @ApiPropertyOptional({ type: [String], description: 'Позиции, исключённые из склада поштучно (materials.id)' })
  @IsOptional() @IsArray() @ArrayMaxSize(2000, { message: 'Исключений не больше 2000' }) @ArrayUnique({ message: 'Позиция указана дважды' }) @IsMongoId({ each: true, message: 'Некорректная позиция' })
  excludeMaterialIds?: string[];

  @ApiPropertyOptional({ description: '«Основной»: ещё и позиции без категории; такой склад один' })
  @IsOptional() @IsBoolean() isDefault?: boolean;

  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(10000) order?: number;
}

export class UpdateStockZoneDto {
  @IsOptional() @IsString({ message: 'Название — текст' }) @Length(1, 80, { message: 'Название склада — от 1 до 80 символов' }) name?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(200) @ArrayUnique() @IsMongoId({ each: true, message: 'Некорректная категория' }) categoryIds?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(2000) @ArrayUnique() @IsMongoId({ each: true, message: 'Некорректная позиция' }) includeMaterialIds?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(2000) @ArrayUnique() @IsMongoId({ each: true, message: 'Некорректная позиция' }) excludeMaterialIds?: string[];
  @IsOptional() @IsBoolean() isDefault?: boolean;
  @IsOptional() @IsInt() @Min(0) @Max(10000) order?: number;
}
