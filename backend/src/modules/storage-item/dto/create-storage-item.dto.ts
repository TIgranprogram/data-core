import { IsArray, IsBoolean, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { IsObjectId } from '../../../common/decorators/is-object-id.decorator';

export class CreateStorageItemDto {
  @IsObjectId()
  warehouseId!: string;

  /** Exactly one of productId/materialId is required by StorageItemService. */
  @IsOptional()
  @IsObjectId()
  productId?: string;

  @IsOptional()
  @IsObjectId()
  materialId?: string;

  @IsOptional() @IsString() zoneName?: string;
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() description?: string;

  @IsOptional() @IsNumber() @Min(0) quantity?: number;
  @IsOptional() @IsNumber() @Min(0) reservedQty?: number;
  @IsOptional() @IsNumber() @Min(0) minQuantity?: number;
  @IsOptional() @IsNumber() @Min(0) weightKg?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  photos?: string[];
}
