import { ArrayMinSize, IsArray, IsNumber, IsOptional, IsPositive, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { IsObjectId } from '../../../common/decorators/is-object-id.decorator';

/**
 * TZ-NX-WH-INV-BE-BATCH — one physical-count line. Exactly one of
 * materialId/productId (explicit catalog id) or article/sku (looked up
 * server-side) identifies the nomenclature; exactly one of warehouseId/
 * warehouseName/neither (falls back to the default warehouse) identifies
 * the storage location. `qty` is the only quantity input — PO decision:
 * no kg->pcs conversion anywhere on this path.
 */
export class InventoryBatchRowDto {
  @IsOptional() @IsObjectId() materialId?: string;
  @IsOptional() @IsObjectId() productId?: string;
  @IsOptional() @IsString() article?: string;
  @IsOptional() @IsString() sku?: string;

  @IsOptional() @IsObjectId() warehouseId?: string;
  @IsOptional() @IsString() warehouseName?: string;

  @IsNumber()
  @IsPositive()
  qty!: number;

  @IsOptional() @IsString() documentRef?: string;
}

export class BatchInventoryInDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => InventoryBatchRowDto)
  rows!: InventoryBatchRowDto[];

  /** Default `documentRef` for rows that omit their own (e.g. "inventory-2026-09-11"). */
  @IsOptional() @IsString() documentRef?: string;
}

export interface InventoryBatchRowError {
  readonly index: number;
  readonly message: string;
}

export interface InventoryBatchResult {
  readonly created: number;
  readonly errors: readonly InventoryBatchRowError[];
}
