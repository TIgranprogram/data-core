import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsObjectId } from '../../../common/decorators/is-object-id.decorator';

/**
 * TZ-DOC-STUDIO-201b — Create DTO for StudioDocument.
 *
 * `organizationId` is server-derived from auth (never accepted from client).
 * `docTypeId` is optional on create (required only when transitioning to final).
 */
export class CreateStudioDocumentDto {
  @ApiProperty({ example: 'Коммерческое предложение №12' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiPropertyOptional({ description: 'Optional doc type; required before finalize' })
  @IsOptional()
  @IsObjectId()
  docTypeId?: string;

  @ApiPropertyOptional({ description: 'Source DocumentTemplate when created from template' })
  @IsOptional()
  @IsObjectId()
  sourceTemplateId?: string;

  @ApiPropertyOptional({ enum: ['A3', 'A4', 'A5'], default: 'A4' })
  @IsOptional()
  @IsEnum(['A3', 'A4', 'A5'])
  pageSize?: 'A3' | 'A4' | 'A5';

  @ApiPropertyOptional({ enum: ['portrait', 'landscape'], default: 'portrait' })
  @IsOptional()
  @IsEnum(['portrait', 'landscape'])
  orientation?: 'portrait' | 'landscape';

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  backgroundImage?: string[];

  @ApiPropertyOptional({ default: -1 })
  @IsOptional()
  @IsNumber()
  defaultBackgroundIndex?: number;

  @ApiPropertyOptional({ default: 0.3 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  backgroundOpacity?: number;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  pageNumbering?: boolean;

  @ApiPropertyOptional({ type: 'object' })
  @IsOptional()
  @IsObject()
  pageMargins?: { top: number; right: number; bottom: number; left: number };

  @ApiPropertyOptional({ type: 'object' })
  @IsOptional()
  @IsObject()
  sheetLayout?: { rowsFirstPage: number; rowsNextPage: number };

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  manualPageCount?: number;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @IsOptional()
  @IsObject()
  context?: Record<string, unknown>;

  @ApiPropertyOptional({ type: 'array', items: { type: 'object' } })
  @IsOptional()
  @IsArray()
  dataAnchors?: Record<string, unknown>[];

  @ApiPropertyOptional({ type: 'array', items: { type: 'object' } })
  @IsOptional()
  @IsArray()
  dataSets?: Record<string, unknown>[];
}
