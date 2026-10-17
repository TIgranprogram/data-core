import { Type } from 'class-transformer';
import { IsArray, IsDateString, IsIn, IsNotEmpty, IsNumber, IsOptional, IsString, Min, ValidateNested } from 'class-validator';
import { IsObjectId } from '../../../common/decorators/is-object-id.decorator';

class PurchaseRequestItemDto {
  @IsObjectId()
  materialId!: string;

  @IsOptional() @IsString() materialName?: string;
  @IsNumber() @Min(0) quantity!: number;
  @IsOptional() @IsString() unit?: string;
  @IsOptional() @IsNumber() @Min(0) estimatedPrice?: number;
}

export class CreatePurchaseRequestDto {
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsDateString() date?: string;
  @IsOptional() @IsObjectId() createdBy?: string;
  @IsOptional() @IsObjectId() orderId?: string;
  @IsOptional() @IsString() sourceType?: string;
  @IsOptional() @IsString() sourceId?: string;

  @IsString() @IsNotEmpty() entityType!: string;
  @IsString() @IsNotEmpty() entityId!: string;
  @IsOptional() @IsString() entityName?: string;
  @IsOptional() @IsString() entitySku?: string;
  @IsOptional() @IsString() entityUnit?: string;

  @IsOptional() @IsNumber() @Min(0) quantity?: number;
  @IsOptional() @IsObjectId() warehouseId?: string;
  @IsOptional() @IsString() zoneName?: string;
  @IsOptional()
  @IsIn(['draft', 'pending', 'approved', 'rejected', 'converted', 'cancelled'])
  status?: 'draft' | 'pending' | 'approved' | 'rejected' | 'converted' | 'cancelled';
  @IsOptional() @IsString() notes?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PurchaseRequestItemDto)
  items?: PurchaseRequestItemDto[];
}
