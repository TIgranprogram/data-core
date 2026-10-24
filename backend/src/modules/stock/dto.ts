import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsMongoId, IsNumber, IsObject, IsOptional, IsString, Length, Min, ValidateNested } from 'class-validator';

export class StockItemDto {
  @ApiPropertyOptional({ description: 'Наименование (обязательно при создании)' }) @IsOptional() @IsString() @Length(1, 300) name?: string;
  @ApiPropertyOptional({ description: 'Единица измерения (по умолчанию «шт»)' }) @IsOptional() @IsString() @Length(1, 30) unit?: string;
  @ApiPropertyOptional({ description: 'Артикул; пусто — автокод СКЛ-<год>-<номер>' }) @IsOptional() @IsString() @Length(0, 100) article?: string;
  @ApiPropertyOptional() @IsOptional() @IsMongoId() categoryId?: string;
  @ApiPropertyOptional({ description: 'Категория по названию (создаётся, если нет)' }) @IsOptional() @IsString() @Length(0, 100) categoryName?: string;
  @ApiPropertyOptional({ description: 'Минимальный остаток' }) @IsOptional() @IsNumber() @Min(0) minQuantity?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) weightKg?: number;
  @ApiPropertyOptional({ description: 'Вес 1 шт., г (хранится в weightKg, кг); null — стереть' }) @IsOptional() @IsNumber() @Min(0) weightG?: number | null;
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
  @ApiProperty({ enum: ['in', 'out', 'adjust', 'reserve', 'unreserve', 'count'], description: 'приход / списание / корректировка (±) / бронь / снять бронь / пересчёт (qty — сколько лежит всего)' })
  @IsIn(['in', 'out', 'adjust', 'reserve', 'unreserve', 'count']) type!: 'in' | 'out' | 'adjust' | 'reserve' | 'unreserve' | 'count';
  @ApiProperty({ description: 'Количество > 0; для adjust — изменение со знаком; для count — сколько лежит ВСЕГО (с бронью), ≥ 0' }) @IsNumber() qty!: number;
  @ApiPropertyOptional({ description: 'count: остаток, который видел человек; не совпал с сервером — 409' }) @IsOptional() @IsNumber() expected?: number;
  @ApiPropertyOptional({ description: 'count/adjust ниже брони — подтверждено' }) @IsOptional() @IsBoolean() force?: boolean;
  @ApiPropertyOptional({ description: 'По весу (in / count): { unitWeightG? | sampleCount + sampleWeightG, batchesG: [], tareG?, saveUnitWeight? } — штуки считает сервер' }) @IsOptional() @IsObject() byWeight?: { unitWeightG?: number; sampleCount?: number; sampleWeightG?: number; batchesG: number[]; tareG?: number; saveUnitWeight?: boolean };
  @ApiPropertyOptional({ description: 'Примечание / основание / для кого бронь' }) @IsOptional() @IsString() @Length(0, 500) note?: string;
  @ApiPropertyOptional({ description: 'Ключ операции клиента — повтор с тем же ключом ничего не меняет' }) @IsOptional() @IsString() @Length(1, 100) clientUid?: string;
  @ApiPropertyOptional({ description: 'Списание: кому выдано — сотрудник (persons.id)' }) @IsOptional() @IsMongoId() personId?: string;
  @ApiPropertyOptional({ description: 'Списание: кому / куда выдано текстом (объект, бригада)' }) @IsOptional() @IsString() @Length(0, 200) issuedTo?: string;
  @ApiPropertyOptional({ description: 'Выдача под заказ заказчика (salesorders.id)' }) @IsOptional() @IsMongoId() salesOrderId?: string;
  @ApiPropertyOptional({ description: 'Выдача / возврат под позицию заказа (incomes.id); заказ сервер берёт из позиции' }) @IsOptional() @IsMongoId() salesOrderLineId?: string;
  @ApiPropertyOptional({ description: 'Списание: причина из справочника «Причины списания» (брак, потеря, порча, прочее)' }) @IsOptional() @IsString() @Length(0, 100) reason?: string;
  @ApiPropertyOptional({ description: 'Это списание (out без заказа и сотрудника): причина обязательна' }) @IsOptional() @IsBoolean() writeOff?: boolean;
  @ApiPropertyOptional({ description: 'Возврат со сборки: приход (in) под позицию заказа' }) @IsOptional() @IsBoolean() isReturn?: boolean;
}

export class StockBatchLineDto {
  @ApiProperty() @IsMongoId() materialId!: string;
  @ApiProperty({ description: 'Количество > 0; для count — фактический остаток (≥ 0)' }) @IsNumber() @Min(0) qty!: number;
  @ApiPropertyOptional({ description: 'Примечание строки (расчёт по весу, НО)' }) @IsOptional() @IsString() @Length(0, 500) note?: string;
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
  @ApiPropertyOptional({ description: 'Списание: причина из справочника «Причины списания»' }) @IsOptional() @IsString() @Length(0, 100) reason?: string;
  @ApiPropertyOptional({ description: 'Это списание (out без заказа и сотрудника): причина обязательна' }) @IsOptional() @IsBoolean() writeOff?: boolean;
  @ApiPropertyOptional({ description: 'Возврат со сборки: приход (in) под позицию заказа' }) @IsOptional() @IsBoolean() isReturn?: boolean;
  @ApiPropertyOptional({ description: 'Пересчёт ниже брони — подтверждено' }) @IsOptional() @IsBoolean() force?: boolean;
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
  @ApiPropertyOptional({ description: 'Под позицию заказа (incomes.id) — для всех строк списка; заказ сервер берёт из позиции (SK-6)' }) @IsOptional() @IsMongoId() salesOrderLineId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 100) clientUid?: string;
}

/** Правка брони (SK-6): количество (остаток брони), заказ, позиция заказа, примечание. null — убрать привязку. */
export class StockReservationUpdateDto {
  @ApiPropertyOptional({ description: 'Новое количество в брони (> 0); больше прежнего — только в пределах свободного' }) @IsOptional() @IsNumber() @Min(0) qty?: number;
  @ApiPropertyOptional({ description: 'Заказ (salesorders.id); null — снять привязку к заказу (и к позиции)', nullable: true }) @IsOptional() @IsMongoId() salesOrderId?: string | null;
  @ApiPropertyOptional({ description: 'Позиция заказа (incomes.id); null — снять позицию', nullable: true }) @IsOptional() @IsMongoId() salesOrderLineId?: string | null;
  @ApiPropertyOptional({ description: 'Примечание' }) @IsOptional() @IsString() @Length(0, 500) note?: string;
}

/** «Выдать по заказу» (SK-6): все активные брони заказа или выбранные — одной операцией. */
export class StockIssueOrderDto {
  @ApiProperty({ description: 'Заказ (salesorders.id)' }) @IsMongoId() salesOrderId!: string;
  @ApiPropertyOptional({ type: [String], description: 'Выбранные брони (reservations.id); нет — все активные брони заказа' }) @IsOptional() @IsArray() @ArrayMaxSize(500) @IsMongoId({ each: true }) reservationIds?: string[];
  @ApiPropertyOptional({ description: 'Кому выдано — сотрудник (persons.id)' }) @IsOptional() @IsMongoId() personId?: string;
  @ApiPropertyOptional({ description: 'Кому / куда выдано текстом' }) @IsOptional() @IsString() @Length(0, 200) issuedTo?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 500) note?: string;
  @ApiPropertyOptional({ description: 'Ключ операции клиента — повтор ничего не меняет' }) @IsOptional() @IsString() @Length(1, 100) clientUid?: string;
}

/** Строка спецификации из файла (файл разбирает клиент). */
export class StockSpecLineDto {
  @ApiPropertyOptional({ description: 'Код / артикул позиции склада' }) @IsOptional() @IsString() @Length(0, 100) code?: string;
  @ApiProperty({ description: 'Наименование как на складе' }) @IsString() @Length(1, 300) name!: string;
  @ApiProperty({ description: 'Количество > 0' }) @IsNumber() @Min(0) qty!: number;
  @ApiPropertyOptional({ description: 'Единица измерения; указана и не совпала со складом — строка не сопоставляется' }) @IsOptional() @IsString() @Length(0, 30) unit?: string;
  @ApiPropertyOptional({ description: 'Позиция заказа (incomes.id)' }) @IsOptional() @IsMongoId() salesOrderLineId?: string;
}

export class StockSpecPreviewDto {
  @ApiProperty({ description: 'Заказ, под который бронируем (salesorders.id)' }) @IsMongoId() salesOrderId!: string;
  @ApiProperty({ type: [StockSpecLineDto], description: 'До 500 строк' }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => StockSpecLineDto) lines!: StockSpecLineDto[];
}

/** Подтверждённая строка спецификации: позиция склада уже выбрана (в просмотре). */
export class StockSpecApplyLineDto {
  @ApiPropertyOptional({ description: 'Номер строки в файле — для отчёта' }) @IsOptional() @IsNumber() @Min(0) row?: number;
  @ApiProperty({ description: 'Позиция склада (materials.id)' }) @IsMongoId() materialId!: string;
  @ApiProperty({ description: 'Количество > 0' }) @IsNumber() @Min(0) qty!: number;
  @ApiPropertyOptional({ description: 'Позиция заказа (incomes.id)' }) @IsOptional() @IsMongoId() salesOrderLineId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 500) note?: string;
}

export class StockSpecApplyDto {
  @ApiProperty({ description: 'Заказ (salesorders.id)' }) @IsMongoId() salesOrderId!: string;
  @ApiProperty({ type: [StockSpecApplyLineDto], description: 'До 500 строк' }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => StockSpecApplyLineDto) lines!: StockSpecApplyLineDto[];
  @ApiPropertyOptional({ description: 'true — сначала снять активные брони прежней загрузки спецификации этого заказа' }) @IsOptional() @IsBoolean() replace?: boolean;
  @ApiPropertyOptional({ description: 'true — где не хватает, бронировать сколько свободно (по умолчанию такие строки пропускаются)' }) @IsOptional() @IsBoolean() takeFree?: boolean;
  @ApiPropertyOptional({ description: 'Ключ операции клиента — повтор не создаёт дублей' }) @IsOptional() @IsString() @Length(1, 100) clientUid?: string;
}

export class StockPhotoDto {
  @ApiProperty({ description: 'id фото из POST /api/photos/upload' }) @IsMongoId() photoId!: string;
}
