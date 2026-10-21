import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsMongoId, IsNumber, IsObject, IsOptional, IsString, Length, Min, ValidateNested } from 'class-validator';

export class StockItemDto {
  @ApiPropertyOptional({ description: 'Наименование (обязательно при создании)' }) @IsOptional() @IsString() @Length(1, 300) name?: string;
  @ApiPropertyOptional({ description: 'Единица измерения (по умолчанию «шт»)' }) @IsOptional() @IsString() @Length(1, 30) unit?: string;
  @ApiPropertyOptional({ description: 'Артикул; пусто — автокод СКЛ-<год>-<номер>' }) @IsOptional() @IsString() @Length(0, 100) article?: string;
  @ApiPropertyOptional() @IsOptional() @IsMongoId() categoryId?: string;
  @ApiPropertyOptional({ description: 'Категория по названию (создаётся, если нет)' }) @IsOptional() @IsString() @Length(0, 100) categoryName?: string;
  @ApiPropertyOptional({ description: 'Минимальный остаток' }) @IsOptional() @IsNumber() @Min(0) minQuantity?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) weightKg?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 2000) notes?: string;
  @ApiPropertyOptional({ description: 'Металл: сортамент / сечение (40×20×2, 2 мм); null — стереть' }) @IsOptional() @IsString() @Length(0, 200) assortment?: string | null;
  @ApiPropertyOptional({ description: 'Марка стали (Ст3, AISI 304); null — стереть' }) @IsOptional() @IsString() @Length(0, 100) materialGrade?: string | null;
  @ApiPropertyOptional({ description: 'Размеры, мм: { length, width, thickness, diameter } (null — стереть)' }) @IsOptional() @IsObject() dims?: { length?: number | null; width?: number | null; thickness?: number | null; diameter?: number | null };
}

/** Обрезок, который ещё пригодится (TASKS СМ.2). */
export class StockOffcutDto {
  @ApiProperty({ description: 'Длина обрезка, мм' }) @IsNumber() @Min(1) lengthMm!: number;
  @ApiPropertyOptional({ description: 'Ширина (лист), мм' }) @IsOptional() @IsNumber() @Min(1) widthMm?: number;
  @ApiPropertyOptional({ description: 'Сколько таких кусков (по умолчанию 1)' }) @IsOptional() @IsNumber() @Min(1) count?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 300) note?: string;
}

export class StockMoveDto {
  @ApiProperty({ enum: ['in', 'out', 'adjust', 'reserve', 'unreserve'], description: 'приход / списание / корректировка (±) / бронь / снять бронь' })
  @IsIn(['in', 'out', 'adjust', 'reserve', 'unreserve']) type!: 'in' | 'out' | 'adjust' | 'reserve' | 'unreserve';
  @ApiProperty({ description: 'Количество > 0; для adjust — изменение со знаком' }) @IsNumber() qty!: number;
  @ApiPropertyOptional({ description: 'Примечание / основание / для кого бронь' }) @IsOptional() @IsString() @Length(0, 500) note?: string;
  @ApiPropertyOptional({ description: 'Ключ операции клиента — повтор с тем же ключом ничего не меняет' }) @IsOptional() @IsString() @Length(1, 100) clientUid?: string;
  @ApiPropertyOptional({ description: 'Списание: кому выдано — сотрудник (persons.id)' }) @IsOptional() @IsMongoId() personId?: string;
  @ApiPropertyOptional({ description: 'Списание: кому / куда выдано текстом (объект, бригада)' }) @IsOptional() @IsString() @Length(0, 200) issuedTo?: string;
}

export class StockBatchLineDto {
  @ApiProperty() @IsMongoId() materialId!: string;
  @ApiProperty({ description: 'Количество > 0; для count — фактический остаток (≥ 0)' }) @IsNumber() @Min(0) qty!: number;
}

export class StockBatchDto {
  @ApiProperty({ enum: ['in', 'out', 'count'], description: 'приход / списание / пересчёт (qty = сколько лежит фактически)' })
  @IsIn(['in', 'out', 'count']) type!: 'in' | 'out' | 'count';
  @ApiProperty({ type: [StockBatchLineDto] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => StockBatchLineDto) lines!: StockBatchLineDto[];
  @ApiPropertyOptional({ description: 'Основание / куда / от кого' }) @IsOptional() @IsString() @Length(0, 500) note?: string;
  @ApiPropertyOptional({ description: 'Документ: накладная, счёт' }) @IsOptional() @IsString() @Length(0, 200) documentRef?: string;
  @ApiPropertyOptional({ description: 'Списание под заказ заказчика (salesorders.id)' }) @IsOptional() @IsMongoId() salesOrderId?: string;
  @ApiPropertyOptional({ description: 'Позиция заказа (incomes.id)' }) @IsOptional() @IsMongoId() salesOrderLineId?: string;
  @ApiPropertyOptional({ description: 'Ключ операции клиента — повтор ничего не меняет' }) @IsOptional() @IsString() @Length(1, 100) clientUid?: string;
  @ApiPropertyOptional({ description: 'Списание: кому выдано — сотрудник (persons.id)' }) @IsOptional() @IsMongoId() personId?: string;
  @ApiPropertyOptional({ description: 'Списание: кому / куда выдано текстом (объект, бригада)' }) @IsOptional() @IsString() @Length(0, 200) issuedTo?: string;
}

export class StockIssueLineDto {
  @ApiProperty({ description: 'Бронь (reservations.id)' }) @IsMongoId() reservationId!: string;
  @ApiPropertyOptional({ description: 'Сколько выдать; нет — всю бронь' }) @IsOptional() @IsNumber() @Min(0) qty?: number;
}

/** «Выдать по брони» (TASKS Б.2): списание по броням одной операцией. */
export class StockIssueDto {
  @ApiProperty({ type: [StockIssueLineDto] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => StockIssueLineDto) lines!: StockIssueLineDto[];
  @ApiPropertyOptional({ description: 'Кому выдано — сотрудник (persons.id)' }) @IsOptional() @IsMongoId() personId?: string;
  @ApiPropertyOptional({ description: 'Кому / куда выдано текстом' }) @IsOptional() @IsString() @Length(0, 200) issuedTo?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 500) note?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 100) clientUid?: string;
}

export class StockReserveListDto {
  @ApiProperty({ description: 'Для чего бронь: конструкция / изделие' }) @IsString() @Length(1, 200) groupName!: string;
  @ApiProperty({ type: [StockBatchLineDto] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => StockBatchLineDto) lines!: StockBatchLineDto[];
  @ApiPropertyOptional({ description: 'Под заказ (salesorders.id)' }) @IsOptional() @IsMongoId() salesOrderId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 100) clientUid?: string;
}

export class StockPhotoDto {
  @ApiProperty({ description: 'id фото из POST /api/photos/upload' }) @IsMongoId() photoId!: string;
}
