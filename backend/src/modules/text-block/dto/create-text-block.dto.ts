import {
  IsArray,
  IsBoolean,
  IsMongoId,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * CreateTextBlockDto — simplified (TZ-DOC-323).
 *
 * Only `name` is required. `slug`, `tags`, `content`, `columns`,
 * `categoryId?` are optional. For multi-column blocks, pass `columns[]`
 * and omit `content`.
 *
 * TZ-DOC-323: the legacy `category: 'legal'|'intro'|'outro'|'custom'`
 * field has been removed from the DTO entirely. Callers that still send
 * it receive an explicit 400 from the global `ValidationPipe`
 * (`forbidNonWhitelisted: true` in `backend/src/main.ts:156-161`).
 * Use `categoryId` instead — it is resolved server-side through
 * `TextBlockCategoryService`.
 */
export class ColumnDto {
  @IsString()
  @IsNotEmpty()
  id!: string;

  @IsOptional()
  @IsString()
  @MaxLength(50000)
  content?: string;

  @IsOptional()
  @IsNumber()
  width?: number;

  @IsOptional()
  @IsNumber()
  fontSize?: number;
}

export class CreateTextBlockDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  slug?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(50000)
  content?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ColumnDto)
  columns?: ColumnDto[];

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsNumber()
  sortOrder?: number;

  @IsOptional()
  @IsMongoId()
  categoryId?: string;
}
