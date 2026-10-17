import { IsInt, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { OmitType } from '@nestjs/mapped-types';
import { CreateTemplateBlockDto } from '../../template-block/dto/create-template-block.dto';

/** Block payload for POST /studio-documents/:id/blocks (no parent refs — set server-side). */
export class StudioBlockPayloadDto extends OmitType(CreateTemplateBlockDto, [
  'templateId',
  'parentType',
  'parentId',
] as const) {}

/**
 * TZ-DOC-STUDIO-2002 — create block on studio document with revision gate.
 */
export class CreateStudioBlockDto extends StudioBlockPayloadDto {
  @ApiProperty({ description: 'Client-known revision; mismatch → 409' })
  @IsInt()
  @Min(1)
  expectedRevision!: number;
}
