import { ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsMongoId, IsNumber, IsOptional, IsPositive, IsString, Length, Min } from 'class-validator';

export class CreateInvoicesDto {
  @ApiPropertyOptional({ description: 'Заявки, которые заказываем (id); делятся на счета по поставщику', type: [String] })
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200) @IsMongoId({ each: true }) requestIds!: string[];
}

export class AddInvoiceRequestsDto {
  @ApiPropertyOptional({ description: 'Заявки, которые добавляем в этот счёт (id)', type: [String] })
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200) @IsMongoId({ each: true }) requestIds!: string[];
  @ApiPropertyOptional({ description: 'Причина корректировки, обязательна для уже оплаченного счёта' })
  @IsOptional() @IsString() @Length(0, 500) reason?: string;
}

/** Обход блока администратором (ЗЯ-1b): без `confirm` — только план, с `confirm: true` и причиной — выполнение. */
export class AdminOverrideDto {
  @ApiPropertyOptional({ description: 'Подтверждение выполнения (false/нет — вернуть план без изменений)' })
  @IsOptional() @IsBoolean() confirm?: boolean;
  @ApiPropertyOptional({ description: 'Причина (от 3 символов), обязательна при confirm' })
  @IsOptional() @IsString() @Length(0, 500) reason?: string;
}

export class ReceiveInvoiceDto {
  @ApiPropertyOptional({ description: 'Какие заявки счёта принять (id); по умолчанию — все неполученные', type: [String] })
  @IsOptional() @IsArray() @ArrayMaxSize(200) @IsMongoId({ each: true }) requestIds?: string[];
}

export class PatchInvoiceDto {
  @ApiPropertyOptional({ description: 'Дата доставки, пустая строка очищает поле' }) @IsOptional() @IsString() @Length(0, 30) deliveryDate?: string;
  @ApiPropertyOptional({ description: 'Примечание к счёту' }) @IsOptional() @IsString() @Length(0, 1000) note?: string;
  @ApiPropertyOptional({ description: '№ счёта' }) @IsOptional() @IsString() @Length(0, 100) no?: string;
  @ApiPropertyOptional({ description: 'Дата счёта ГГГГ-ММ-ДД или ДД.ММ.ГГГГ' }) @IsOptional() @IsString() @Length(0, 30) date?: string;
  @ApiPropertyOptional({ description: 'Сумма счёта, ₽ (производная от строк; принимать равной сумме строк)' }) @IsOptional() @IsNumber() @Min(0) amount?: number;
  @ApiPropertyOptional({ description: 'Плательщик — наша компания (id организации); "" — снять' }) @IsOptional() @IsString() @Length(0, 30) payerCompanyId?: string;
  @ApiPropertyOptional({ description: 'Поставщик (id организации) — сменить, пока счёт не оплачен; переносится во все заявки счёта' }) @IsOptional() @IsString() @Length(1, 30) supplierId?: string;
  @ApiPropertyOptional({ description: 'Договор поставщика (id из /supply/contracts, того же поставщика, не закрытый); "" — снять' }) @IsOptional() @IsString() @Length(0, 30) contractId?: string;
  @ApiPropertyOptional({ description: 'Файлы счёта (id из POST /api/photos/upload) — весь список', type: [String] })
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsMongoId({ each: true }) fileIds?: string[];
  @ApiPropertyOptional({ description: 'true — «Счёт выставлен»: нужны №, дата и сумма' }) @IsOptional() @IsBoolean() issue?: boolean;
  @ApiPropertyOptional({ description: 'Причина, если счёт с таким № у поставщика уже есть, но нужен отдельный' }) @IsOptional() @IsString() @Length(0, 200) duplicateReason?: string;
}

export class PatchInvoiceLineDto {
  @ApiPropertyOptional({ description: 'Цена за единицу, ₽ (сумма строки = unitPrice × количество)' })
  @IsOptional() @IsNumber() @Min(0) unitPrice?: number;
  @ApiPropertyOptional({ description: 'Сумма строки, ₽ (цена за единицу пересчитывается обратно)' })
  @IsOptional() @IsNumber() @Min(0) lineAmount?: number;
  @ApiPropertyOptional({ description: 'Количество (> 0); без цены сохраняется прежняя цена за единицу, сумма строки пересчитывается' })
  @IsOptional() @IsNumber() @IsPositive() qty?: number;
  @ApiPropertyOptional({ description: 'Ожидаемая версия счёта — оптимистичная блокировка (не совпала → 409)' })
  @IsOptional() @IsInt() @Min(0) version?: number;
  @ApiPropertyOptional({ description: 'Причина корректировки, обязательна для уже оплаченного счёта' })
  @IsOptional() @IsString() @Length(0, 500) reason?: string;
}

export const MERGE_STRATEGIES = ['append', 'mergeSameRequest', 'replaceLines'] as const;
export type MergeStrategy = (typeof MERGE_STRATEGIES)[number];

export class MergeInvoicesDto {
  @ApiPropertyOptional({ description: 'Счёт, в который объединяем (id)' })
  @IsMongoId() targetId!: string;
  @ApiPropertyOptional({ description: 'append — добавить все строки; mergeSameRequest — пропустить одинаковые; replaceLines — заменить строки цели', enum: MERGE_STRATEGIES })
  @IsOptional() @IsIn(MERGE_STRATEGIES) strategy?: MergeStrategy;
}
