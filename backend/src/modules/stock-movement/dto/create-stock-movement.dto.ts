import { IsIn, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { IsObjectId } from '../../../common/decorators/is-object-id.decorator';

export class CreateStockMovementDto {
  @IsIn(['in', 'out', 'transfer', 'adjust'])
  type!: 'in' | 'out' | 'transfer' | 'adjust';

  @IsOptional()
  @IsObjectId()
  productId?: string;

  @IsOptional()
  @IsObjectId()
  materialId?: string;

  @IsObjectId()
  warehouseId!: string;

  @IsOptional() @IsObjectId() toWarehouseId?: string;
  @IsOptional() @IsString() zoneName?: string;
  @IsOptional() @IsString() toZoneName?: string;

  @IsNumber()
  @Min(0.0001)
  qty!: number;

  @IsOptional() @IsNumber() @Min(0) cost?: number;
  @IsOptional() @IsString() orderId?: string;
  @IsOptional() @IsString() documentRef?: string;
  @IsOptional() @IsObjectId() createdBy?: string;
}
