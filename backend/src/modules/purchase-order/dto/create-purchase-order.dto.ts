import { Type } from 'class-transformer';
import { IsArray, IsDateString, IsNotEmpty, IsNumber, IsOptional, IsString, Min, ValidateNested } from 'class-validator';
import { IsObjectId } from '../../../common/decorators/is-object-id.decorator';

class PurchaseOrderItemDto {
  @IsObjectId()
  materialId!: string;

  @IsOptional() @IsString() materialName?: string;
  @IsNumber() @Min(0) quantity!: number;
  @IsOptional() @IsString() unit?: string;
  @IsNumber() @Min(0) unitPrice!: number;
  @IsOptional() @IsString() notes?: string;
}

export class CreatePurchaseOrderDto {
  @IsString() @IsNotEmpty() number!: string;
  @IsOptional() @IsString() title?: string;
  @IsObjectId() supplierId!: string;
  @IsOptional() @IsObjectId() warehouseId?: string;
  @IsOptional() @IsDateString() deliveryDate?: string;
  @IsOptional() @IsString() notes?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PurchaseOrderItemDto)
  items!: PurchaseOrderItemDto[];
}
