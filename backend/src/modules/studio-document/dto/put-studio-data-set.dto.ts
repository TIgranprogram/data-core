import { IsInt, IsObject, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * TZ-DOC-STUDIO-701 — PUT body for a single dataSet upsert on StudioDocument.
 * Same optimistic revision gate as PATCH.
 */
export class PutStudioDataSetDto {
  @ApiProperty({ description: 'Client-known revision; mismatch → 409' })
  @IsInt()
  @Min(1)
  expectedRevision!: number;

  @ApiProperty({ type: 'object', additionalProperties: true })
  @IsObject()
  dataSet!: Record<string, unknown>;
}
