import { IsOptional, IsString, Length } from 'class-validator';
import { IsObjectId } from '../../../common/decorators/is-object-id.decorator';

export class CreateSiteDto {
  @IsObjectId()
  counterpartyId!: string;

  @IsString()
  @Length(1, 256)
  name!: string;

  @IsString()
  @Length(1, 512)
  address!: string;
}

export class UpdateSiteDto {
  @IsOptional() @IsString() @Length(1, 256) name?: string;
  @IsOptional() @IsString() @Length(1, 512) address?: string;
}

/** TZ-ORDERS-336 — reuse convert helper from the order form. */
export class EnsureDefaultSiteDto {
  @IsObjectId()
  counterpartyId!: string;
}
