import { PartialType } from '@nestjs/mapped-types';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Min,
} from 'class-validator';
import { IsObjectId } from '../../../common/decorators/is-object-id.decorator';
import type {
  SupplyRequestPriority,
  SupplyRequestStatus,
} from '../supply-request.schema';

export const SUPPLY_REQUEST_STATUSES = [
  'in_progress',
  'requested',
  'ordered',
  'received',
  'cancelled',
] as const;

export const SUPPLY_REQUEST_PRIORITIES = ['urgent', 'normal', 'low'] as const;

export class CreateSupplyRequestDto {
  @IsOptional()
  @IsString()
  @Length(1, 256)
  title?: string;

  @IsOptional()
  @IsObjectId()
  categoryId?: string;

  @IsOptional()
  @IsObjectId()
  materialId?: string;

  @IsOptional()
  @IsString()
  @Length(0, 256)
  article?: string;

  @IsOptional()
  @IsString()
  @Length(0, 128)
  color?: string;

  @IsOptional()
  @IsString()
  @Length(0, 2048)
  productUrl?: string;

  @IsOptional()
  @IsObjectId()
  supplierId?: string;

  @IsOptional()
  @IsObjectId()
  supplierContactId?: string;

  @IsOptional()
  @IsObjectId()
  companyId?: string;

  @IsOptional()
  @IsString()
  @Length(0, 128)
  requestedBy?: string;

  @IsOptional()
  @IsObjectId()
  orderId?: string;

  /** Free-text заказчик/участок when no matching Order — XOR with `orderId` (service clears it when orderId is set). */
  @IsOptional()
  @IsString()
  @Length(0, 256)
  orderLabel?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  qty?: number;

  @IsOptional()
  @IsString()
  @Length(0, 32)
  unit?: string;

  @IsOptional()
  @IsDateString()
  neededBy?: string;

  @IsOptional()
  @IsIn(SUPPLY_REQUEST_STATUSES)
  status?: SupplyRequestStatus;

  @IsOptional()
  @IsIn(SUPPLY_REQUEST_PRIORITIES)
  priority?: SupplyRequestPriority;

  @IsOptional()
  @IsString()
  @Length(0, 2000)
  notes?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  priceHint?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  lineTotal?: number;

  @IsOptional()
  @IsDateString()
  supplierOrderDate?: string;

  @IsOptional()
  @IsString()
  @Length(0, 128)
  responsible?: string;

  @IsOptional()
  @IsString()
  @Length(0, 128)
  invoiceNo?: string;

  @IsOptional()
  @IsString()
  @Length(0, 2000)
  deliveryNote?: string;

  /** Отдельный флаг — не связан со `status`; сервер сам проставляет/чистит `paidAt`. */
  @IsOptional()
  @IsBoolean()
  paid?: boolean;
}

export class UpdateSupplyRequestDto extends PartialType(CreateSupplyRequestDto) {}

/** TZ-NX-SUPPLY-S4-RECEIVE-TO-STOCK — confirm receipt → StockMovement IN. */
export class ReceiveSupplyRequestDto {
  /** Omit to use the default warehouse (`WarehouseService.findDefault`). */
  @IsOptional()
  @IsObjectId()
  warehouseId?: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0.0001)
  receivedQty!: number;
}
