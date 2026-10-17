import { Type } from 'class-transformer';
import { IsArray, IsDateString, IsIn, IsNumber, IsOptional, IsString, Min, ValidateNested } from 'class-validator';
import { IsObjectId } from '../../../common/decorators/is-object-id.decorator';

export class ShipmentItemDto {
  @IsObjectId()
  productId!: string;

  @IsOptional() @IsString() productName?: string;

  @IsNumber() @Min(0)
  quantity!: number;

  @IsOptional() @IsString() unit?: string;
}

export class CreateShipmentDto {
  @IsOptional() @IsString() number?: string;

  @IsObjectId()
  orderId!: string;

  @IsObjectId()
  counterpartyId!: string;

  @IsOptional() @IsDateString() date?: string;
  @IsOptional() @IsString() recipient?: string;
  @IsOptional() @IsString() address?: string;

  @IsOptional()
  @IsIn(['draft', 'scheduled', 'in_transit', 'delivered', 'cancelled'])
  status?: 'draft' | 'scheduled' | 'in_transit' | 'delivered' | 'cancelled';

  @IsOptional() @IsString() driverInfo?: string;
  @IsOptional() @IsObjectId() warehouseId?: string;

  @IsOptional() @IsString() notes?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ShipmentItemDto)
  items!: ShipmentItemDto[];
}
