import { IsInt, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { UpdateTemplateBlockLayoutsDto } from '../../template-block/dto/update-layouts.dto';

/**
 * TZ-DOC-STUDIO-2002 — batch layout update with revision gate.
 */
export class UpdateStudioBlockLayoutsDto extends UpdateTemplateBlockLayoutsDto {
  @ApiProperty({ description: 'Client-known revision; mismatch → 409' })
  @IsInt()
  @Min(1)
  expectedRevision!: number;
}
