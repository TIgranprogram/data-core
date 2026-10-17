import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsNumber,
  IsOptional,
  Min,
  ValidateNested,
} from 'class-validator';
import { IsObjectId } from '../../../common/decorators/is-object-id.decorator';

export class AttachOrganizationItemDto {
  @IsObjectId()
  organizationId!: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  orgMarkupPercent?: number;
}

export class AttachOrganizationsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => AttachOrganizationItemDto)
  items!: AttachOrganizationItemDto[];
}
