import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsEnum, IsMongoId, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { ATTACHMENT_ENTITY_TYPES, ATTACHMENT_TYPES, AttachmentEntityType, AttachmentType } from './attachment.schema';

export class CreateAttachmentDto {
  @ApiProperty({ enum: ATTACHMENT_ENTITY_TYPES })
  @IsEnum(ATTACHMENT_ENTITY_TYPES)
  entityType!: AttachmentEntityType;

  @ApiProperty({ description: 'Product, ProductModule, or Material id' })
  @IsMongoId()
  entityId!: string;

  @ApiProperty({ enum: ATTACHMENT_TYPES })
  @IsEnum(ATTACHMENT_TYPES)
  type!: AttachmentType;

  @ApiProperty({ example: 'Installation drawing' })
  @IsString()
  @MaxLength(256)
  name!: string;

  @ApiProperty({ example: '/uploads/catalog/drawing.pdf' })
  @IsString()
  @MaxLength(2048)
  storageUrl!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(128)
  mimeType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  sizeBytes?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  description?: string;

  @ApiPropertyOptional({ description: 'Optional explicit organization scope' })
  @IsOptional()
  @IsMongoId()
  organizationId?: string;
}

export class UpdateAttachmentDto extends PartialType(CreateAttachmentDto) {}
