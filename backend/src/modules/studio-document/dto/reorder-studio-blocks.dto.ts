import { IsInt, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { ReorderBlocksDto } from '../../template-block/dto/reorder-blocks.dto';

/**
 * TZ-DOC-STUDIO-2002 — reorder blocks with revision gate.
 */
export class ReorderStudioBlocksDto extends ReorderBlocksDto {
  @ApiProperty({ description: 'Client-known revision; mismatch → 409' })
  @IsInt()
  @Min(1)
  expectedRevision!: number;
}
