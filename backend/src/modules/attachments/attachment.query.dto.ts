import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsMongoId } from 'class-validator';
import { ATTACHMENT_ENTITY_TYPES, AttachmentEntityType } from './attachment.schema';

export class ListAttachmentsQueryDto {
  @ApiProperty({ enum: ATTACHMENT_ENTITY_TYPES })
  @IsEnum(ATTACHMENT_ENTITY_TYPES)
  entityType!: AttachmentEntityType;

  @ApiProperty()
  @IsMongoId()
  entityId!: string;
}
