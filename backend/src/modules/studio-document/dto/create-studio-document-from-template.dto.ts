import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsObjectId } from '../../../common/decorators/is-object-id.decorator';

/**
 * TZ-DOC-STUDIO-1301 — create a studio document from DocumentTemplate + cloned blocks.
 */
export class CreateStudioDocumentFromTemplateDto {
  @ApiProperty({ description: 'Source DocumentTemplate id' })
  @IsObjectId()
  @IsNotEmpty()
  templateId!: string;

  @ApiPropertyOptional({ description: 'Override document name (defaults to template name)' })
  @IsOptional()
  @IsString()
  name?: string;
}
