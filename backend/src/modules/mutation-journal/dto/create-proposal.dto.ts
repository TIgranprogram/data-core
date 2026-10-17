import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsMongoId,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Min,
  ValidateNested,
} from 'class-validator';
import { MATERIAL_KINDS, type MaterialKind } from '../../material/material.schema';
import { DimensionDto } from '../../material/dto/create-material.dto';
import { MUTATION_KINDS } from '../mutation-journal.schema';

export class ProposeMaterialCreateDto {
  @ApiProperty({ example: 'Стекло 4мм' })
  @IsString()
  @Length(1, 256)
  name!: string;

  @ApiPropertyOptional({ example: 'шт', description: 'Единица измерения (default шт)' })
  @IsOptional()
  @IsString()
  @Length(1, 32)
  unit?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(0, 64)
  article?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(0, 64)
  sku?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsMongoId()
  categoryId?: string;

  // TZD-32: whitelist расширения propose create (зеркало CreateMaterialDto).
  @ApiPropertyOptional({ description: 'Цена за единицу (RUB)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  pricePerUnit?: number;

  @ApiPropertyOptional({ enum: MATERIAL_KINDS, description: 'Тип каталожной позиции' })
  @IsOptional()
  @IsIn(MATERIAL_KINDS)
  materialKind?: MaterialKind;

  @ApiPropertyOptional({ description: 'Описание материала' })
  @IsOptional()
  @IsString()
  @Length(0, 2000)
  description?: string;

  @ApiPropertyOptional({ type: [DimensionDto], description: 'Размеры материала' })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DimensionDto)
  dimensions?: DimensionDto[];
}

export class ProposeMaterialUpdateDto {
  @ApiProperty({ description: 'Material id to update' })
  @IsMongoId()
  id!: string;

  @ApiProperty({ description: 'Partial material fields' })
  @IsObject()
  patch!: Record<string, unknown>;
}

export class ProposeProductCreateDto {
  @ApiProperty({ example: 'Окно ПВХ 1200x1400' })
  @IsString()
  @Length(1, 256)
  name!: string;

  @ApiProperty({ enum: ['good', 'service', 'work'] })
  @IsIn(['good', 'service', 'work'])
  kind!: 'good' | 'service' | 'work';

  @ApiPropertyOptional({ example: 'шт', description: 'Единица измерения (default шт)' })
  @IsOptional()
  @IsString()
  @Length(1, 32)
  unit?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(0, 64)
  sku?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(0, 512)
  notes?: string;

  @ApiPropertyOptional({ description: 'ID категории изделия (null = без категории)' })
  @IsOptional()
  @IsMongoId()
  categoryId?: string | null;

  @ApiPropertyOptional({ enum: ['new', 'active', 'archived', 'draft'], description: 'Статус изделия' })
  @IsOptional()
  @IsIn(['new', 'active', 'archived', 'draft'])
  status?: 'new' | 'active' | 'archived' | 'draft';
}

export class ProposeProductUpdateDto {
  @ApiProperty({ description: 'Product id to update' })
  @IsMongoId()
  id!: string;

  @ApiProperty({ description: 'Partial product passport fields' })
  @IsObject()
  patch!: Record<string, unknown>;
}

// ── TZD-ORDER-IMPORT-01: counterparty/site/order create proposals ────────────

export class ProposeCounterpartyCreateDto {
  @ApiProperty({ example: 'ООО «Дортранссервис»' })
  @IsString()
  @Length(1, 256)
  name!: string;

  @ApiProperty({ example: '7701234567' })
  @IsString()
  @Length(1, 32)
  inn!: string;

  @ApiProperty({ type: [String], example: ['customer'] })
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  roles!: string[];

  @ApiPropertyOptional()
  @IsOptional() @IsString() @Length(0, 256)
  shortName?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString() @Length(0, 128)
  legalForm?: string;

  @ApiPropertyOptional({ enum: ['ooo', 'ip', 'pao', 'ao', 'other'] })
  @IsOptional() @IsIn(['ooo', 'ip', 'pao', 'ao', 'other'])
  legalType?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional() @IsArray() @IsString({ each: true })
  type?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional() @IsArray() @IsString({ each: true })
  partyTypes?: string[];

  @ApiPropertyOptional()
  @IsOptional() @IsString() @Length(0, 32)
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsNumber() @Min(0)
  paymentTermDays?: number;

  @ApiPropertyOptional()
  @IsOptional() @IsNumber() @Min(0)
  vatRate?: number;
}

export class ProposeSiteCreateDto {
  @ApiProperty({ description: 'Counterparty id (может быть entityId только что подтверждённого counterparty.create)' })
  @IsMongoId()
  counterpartyId!: string;

  @ApiProperty({ example: 'Объект на ул. Ленина, 10' })
  @IsString()
  @Length(1, 256)
  name!: string;

  @ApiProperty({ example: 'г. Москва, ул. Ленина, 10' })
  @IsString()
  @Length(1, 512)
  address!: string;
}

export class OrderCreateItemDto {
  @ApiProperty({ description: 'Product id — уже существующий/подтверждённый товар' })
  @IsMongoId()
  productId!: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString() @Length(0, 256)
  productName?: string;

  @ApiProperty({ description: 'Количество из исходного файла' })
  @IsNumber()
  @Min(0.0001)
  quantity!: number;

  @ApiPropertyOptional()
  @IsOptional() @IsString() @Length(0, 32)
  unit?: string;
}

export class ProposeOrderCreateDto {
  @ApiProperty()
  @IsMongoId()
  counterpartyId!: string;

  @ApiProperty()
  @IsMongoId()
  siteId!: string;

  @ApiProperty({ type: [OrderCreateItemDto], minItems: 1, maxItems: 500 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => OrderCreateItemDto)
  items!: OrderCreateItemDto[];

  @ApiPropertyOptional()
  @IsOptional() @IsString() @Length(0, 64)
  number?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString() @Length(0, 2000)
  notes?: string;

  @ApiPropertyOptional({ description: 'ImportTask id — только для трассировки в notes/аудите' })
  @IsOptional() @IsMongoId()
  importTaskId?: string;
}

export class CreateProposalDto {
  @ApiProperty({ enum: MUTATION_KINDS })
  @IsIn(MUTATION_KINDS as unknown as string[])
  kind!: (typeof MUTATION_KINDS)[number];

  @ApiPropertyOptional({ description: 'For material.create' })
  @IsOptional()
  @ValidateNested()
  @Type(() => ProposeMaterialCreateDto)
  create?: ProposeMaterialCreateDto;

  @ApiPropertyOptional({ description: 'For material.update' })
  @IsOptional()
  @ValidateNested()
  @Type(() => ProposeMaterialUpdateDto)
  update?: ProposeMaterialUpdateDto;

  @ApiPropertyOptional({ description: 'For product.create (TZD-27, TZD-43)' })
  @IsOptional()
  @ValidateNested()
  @Type(() => ProposeProductCreateDto)
  productCreate?: ProposeProductCreateDto;

  @ApiPropertyOptional({ description: 'For product.update (TZD-27)' })
  @IsOptional()
  @ValidateNested()
  @Type(() => ProposeProductUpdateDto)
  productUpdate?: ProposeProductUpdateDto;

  @ApiPropertyOptional({ description: 'For counterparty.create (TZD-ORDER-IMPORT-01)' })
  @IsOptional()
  @ValidateNested()
  @Type(() => ProposeCounterpartyCreateDto)
  counterpartyCreate?: ProposeCounterpartyCreateDto;

  @ApiPropertyOptional({ description: 'For site.create (TZD-ORDER-IMPORT-01)' })
  @IsOptional()
  @ValidateNested()
  @Type(() => ProposeSiteCreateDto)
  siteCreate?: ProposeSiteCreateDto;

  @ApiPropertyOptional({ description: 'For order.create (TZD-ORDER-IMPORT-01)' })
  @IsOptional()
  @ValidateNested()
  @Type(() => ProposeOrderCreateDto)
  orderCreate?: ProposeOrderCreateDto;

  @ApiPropertyOptional({ default: 'kppdf_propose_material' })
  @IsOptional()
  @IsString()
  toolName?: string;
}

// ── TZD-18: batch propose/confirm/cancel ──────────────────────────────────────

/**
 * POST /api/mutation-journal/propose-batch (TZD-18).
 * All-or-nothing best-effort: если хоть один item падает — созданные
 * proposals откатываются (cancel) и возвращаются errors. SoT не пишется.
 */
export class ProposeBatchDto {
  @ApiProperty({ type: [CreateProposalDto], minItems: 1, maxItems: 500 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => CreateProposalDto)
  items!: CreateProposalDto[];

  @ApiPropertyOptional({
    description: 'Повторный вызов с тем же ключом вернёт те же proposalIds (dedup по предложенным)',
  })
  @IsOptional()
  @IsString()
  @Length(1, 128)
  idempotencyKey?: string;
}

/** Для confirm-batch / cancel-batch. */
export class ProposalIdsBatchDto {
  @ApiProperty({ type: [String], minItems: 1, maxItems: 500 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsMongoId({ each: true })
  ids!: string[];
}
