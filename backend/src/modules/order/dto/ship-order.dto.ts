import { Type } from 'class-transformer';
import { IsArray, IsNumber, IsOptional, IsString, Min, ValidateNested } from 'class-validator';

export class ShipOrderItemDto {
  /** Stable OrderItem.lineId, not the array index. */
  @IsString()
  lineId!: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  quantity!: number;
}

export class ShipOrderDto {
  @IsOptional()
  @IsString()
  recipient?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  warehouseId?: string;

  @IsOptional()
  @IsString()
  driverInfo?: string;

  /** Omit for the legacy whole-order action; provide for a partial shipment. */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ShipOrderItemDto)
  items?: ShipOrderItemDto[];
}
