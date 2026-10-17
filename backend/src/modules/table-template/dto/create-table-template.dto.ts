import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  COLUMN_TYPES,
  type ColumnType,
  TABLE_TEMPLATE_CATEGORIES,
  type TableTemplateCategory,
} from '../table-template.schema';

/**
 * TZ-NX-SORTORDER-EMPTY-MIN belt-and-braces — a well-behaved client now omits
 * `sortOrder` entirely when its "Порядок" field is empty, but this normalizes
 * `''`/`null`/`NaN` to `undefined` regardless, so `@IsOptional()` actually
 * skips validation for any client that still sends the raw empty value
 * instead of raising the confusing "Значение слишком мало"/"Должно быть
 * числом" pair for what is really just an unset optional field.
 */
const emptyOrNanToUndefined = ({ value }: { value: unknown }): unknown => {
  if (value === '' || value === null) return undefined;
  if (typeof value === 'number' && Number.isNaN(value)) return undefined;
  return value;
};

/**
 * TZ-86 Phase A.2 — TableColumnDto extended.
 *
 * `type` is optional in DTO (default applied at schema level) to keep
 * migration of old frontend calls safe — if a pre-A.2 client forgets
 * `type`, server defaults to 'text'.
 *
 * Other fields (`width`, `align`, `format`) unchanged for backward compat.
 */
export class TableColumnDto {
  @IsString() @IsNotEmpty() key!: string;
  @IsString() @IsNotEmpty() label!: string;

  @IsOptional() @IsIn(COLUMN_TYPES) type?: ColumnType;

  @IsOptional() @IsNumber() @Min(1) width?: number;
  @IsOptional() @IsIn(['left', 'center', 'right'])
  align?: 'left' | 'center' | 'right';
  @IsOptional() @IsString() format?: string;
}

/**
 * TZ-86 Phase A.2 — CreateTableTemplateDto extended.
 *
 * New optional fields: `category`, `sortOrder`, `sampleRows`, `dataSource`.
 * All optional → existing pre-A.2 clients (write only name/columns) still pass.
 */
export class CreateTableTemplateDto {
  @IsString() @IsNotEmpty() name!: string;
  @IsOptional() @IsString() description?: string;

  @IsOptional() @IsIn(TABLE_TEMPLATE_CATEGORIES) category?: TableTemplateCategory;

  @IsOptional() @Transform(emptyOrNanToUndefined) @IsNumber() @Min(0) sortOrder?: number;

  /**
   * Sample rows for the preview endpoint. Each row is `unknown[]` aligned
   * to `columns[]` order. Validated as array-of-arrays (loose element type).
   */
  @IsOptional() @IsArray() sampleRows?: unknown[][];

  /**
   * Registry-resolved dataSource label (e.g. 'products', 'cost-calc').
   * Phase A.5 RegistryController exposes the canonical list.
   */
  @IsOptional() @IsString() dataSource?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TableColumnDto)
  columns!: TableColumnDto[];

  @IsOptional() @IsBoolean() isActive?: boolean;
}
