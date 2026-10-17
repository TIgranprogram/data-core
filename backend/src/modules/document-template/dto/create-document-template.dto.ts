import { IsArray, IsBoolean, IsIn, IsNotEmpty, IsNumber, IsOptional, IsString, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { IsObjectId } from '../../../common/decorators/is-object-id.decorator';

export class DefaultSheetLayoutDto {
  @IsOptional() @IsNumber() @Min(0) rowsFirstPage?: number;
  @IsOptional() @IsNumber() @Min(0) rowsNextPage?: number;
}

export class CreateDocumentTemplateDto {
  @IsString() @IsNotEmpty()
  name!: string;

  @IsOptional() @IsString() description?: string;

  @IsOptional() @IsArray() @IsString({ each: true })
  tags?: string[];  @IsObjectId() organizationId!: string;
  @IsObjectId() docTypeId!: string;

  /**
   * TZ-DOC-307 — optional on the wire; the service ALWAYS assigns a
   * category server-side (provided + validated, or the active default).
   */
  @IsOptional() @IsObjectId()
  categoryId?: string;

  @IsOptional() @IsBoolean() isDefault?: boolean;
  @IsOptional() @IsBoolean() isActive?: boolean;

  /** TZ-DOC-337 — canon aligned with schema + setup chips (ISO paper). */
  @IsOptional() @IsIn(['A3', 'A4', 'A5'])
  pageSize?: 'A3' | 'A4' | 'A5';

  @IsOptional() @IsArray() @IsString({ each: true })
  backgroundImage?: string[];

  @IsOptional() @IsNumber()
  defaultBackgroundIndex?: number;

  @IsOptional() @IsNumber() @Min(0) backgroundOpacity?: number;

  @IsOptional() @IsIn(['portrait', 'landscape'])
  orientation?: 'portrait' | 'landscape';

  @IsOptional() @IsBoolean()
  pageNumbering?: boolean;
  @IsOptional() @IsNumber() @Min(1) version?: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => DefaultSheetLayoutDto)
  defaultSheetLayout?: DefaultSheetLayoutDto;

  @IsOptional() @IsString() notes?: string;

  /** TZ-KP-WS-406 — optional source file reference (MCP/import bridge). */
  @IsOptional() @IsString() sourceFileRef?: string;

  /** TZ-KP-WS-406 — draft origin; defaults to null (legacy rows). */
  @IsOptional() @IsIn(['mcp', 'manual', 'import'])
  draftSource?: 'mcp' | 'manual' | 'import';
}
