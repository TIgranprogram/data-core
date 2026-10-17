import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
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
 * TZ-DOC-STUDIO-201b — PATCH DTO for StudioDocument.
 *
 * `expectedRevision` is mandatory for optimistic concurrency (409 on mismatch).
 */
export class UpdateStudioDocumentDto {
  @ApiProperty({ description: 'Client-known revision; mismatch → 409' })
  @IsInt()
  @Min(1)
  expectedRevision!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObjectId()
  docTypeId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObjectId()
  sourceTemplateId?: string;

  /**
   * TZ-NX-DOCSTUDIO-ISSUER-SELECT — «Исполнитель» (наша фирма). Reassigns
   * `StudioDocument.organizationId` itself (the document's own tenant
   * scope), not a `context` anchor — service enforces the same visibility
   * policy as `OrganizationService.findAll`/`findById` (a bound user can
   * only pick their own org).
   */
  @ApiPropertyOptional()
  @IsOptional()
  @IsObjectId()
  organizationId?: string;

  @ApiPropertyOptional({ enum: ['A3', 'A4', 'A5'] })
  @IsOptional()
  @IsEnum(['A3', 'A4', 'A5'])
  pageSize?: 'A3' | 'A4' | 'A5';

  @ApiPropertyOptional({ enum: ['portrait', 'landscape'] })
  @IsOptional()
  @IsEnum(['portrait', 'landscape'])
  orientation?: 'portrait' | 'landscape';

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  backgroundImage?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  defaultBackgroundIndex?: number;

  @ApiPropertyOptional({ type: [Number] })
  @IsOptional()
  @IsArray()
  @IsNumber({}, { each: true })
  backgroundPageIndices?: number[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  backgroundOpacity?: number;

  @ApiPropertyOptional()
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

  @ApiPropertyOptional({ minimum: 1 })
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

  @ApiPropertyOptional({ enum: ['draft', 'frozen', 'final'] })
  @IsOptional()
  @IsEnum(['draft', 'frozen', 'final'])
  status?: 'draft' | 'frozen' | 'final';
}
