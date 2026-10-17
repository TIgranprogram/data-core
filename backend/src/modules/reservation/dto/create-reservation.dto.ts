import { IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { IsObjectId } from '../../../common/decorators/is-object-id.decorator';

export class CreateReservationDto {
  @IsString()
  @IsNotEmpty()
  orderId!: string;

  /** Exactly one of productId/materialId is required — validated in ReservationService. */
  @IsOptional()
  @IsObjectId()
  productId?: string;

  /** TZ-NX-SUPPLY-S0: kit-reserve holds materials, not finished products. */
  @IsOptional()
  @IsObjectId()
  materialId?: string;

  @IsObjectId()
  warehouseId!: string;

  @IsNumber()
  @Min(0.0001)
  qty!: number;

  @IsOptional() @IsString() zoneName?: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() expiresAt?: Date;
  @IsOptional() @IsNumber() @Min(0) orderItemIndex?: number;
}
