import { IsOptional } from 'class-validator';
import { IsObjectId } from '../../../common/decorators/is-object-id.decorator';

export class CreateCartSessionDto {
  @IsOptional() @IsObjectId() counterpartyId?: string;
  @IsOptional() @IsObjectId() organizationId?: string;
  @IsOptional() @IsObjectId() userId?: string;
  @IsOptional() expiresAt?: string;
}
