import { ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsMongoId, IsNumber, IsOptional, IsString, Length, Min } from 'class-validator';

export class CreateInvoicesDto {
  @ApiPropertyOptional({ description: 'Заявки, которые заказываем (id); делятся на счета по поставщику', type: [String] })
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200) @IsMongoId({ each: true }) requestIds!: string[];
}

export class ReceiveInvoiceDto {
  @ApiPropertyOptional({ description: 'Какие заявки счёта принять (id); по умолчанию — все неполученные', type: [String] })
  @IsOptional() @IsArray() @ArrayMaxSize(200) @IsMongoId({ each: true }) requestIds?: string[];
}

export class PatchInvoiceDto {
  @ApiPropertyOptional({ description: '№ счёта' }) @IsOptional() @IsString() @Length(0, 100) no?: string;
  @ApiPropertyOptional({ description: 'Дата счёта ГГГГ-ММ-ДД или ДД.ММ.ГГГГ' }) @IsOptional() @IsString() @Length(0, 30) date?: string;
  @ApiPropertyOptional({ description: 'Сумма счёта, ₽' }) @IsOptional() @IsNumber() @Min(0) amount?: number;
  @ApiPropertyOptional({ description: 'Плательщик — наша компания (id организации); "" — снять' }) @IsOptional() @IsString() @Length(0, 30) payerCompanyId?: string;
  @ApiPropertyOptional({ description: 'Поставщик (id организации) — сменить, пока счёт не оплачен; переносится во все заявки счёта' }) @IsOptional() @IsString() @Length(1, 30) supplierId?: string;
  @ApiPropertyOptional({ description: 'Договор поставщика (id из /supply/contracts, того же поставщика, не закрытый); "" — снять' }) @IsOptional() @IsString() @Length(0, 30) contractId?: string;
  @ApiPropertyOptional({ description: 'Файлы счёта (id из POST /api/photos/upload) — весь список', type: [String] })
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsMongoId({ each: true }) fileIds?: string[];
  @ApiPropertyOptional({ description: 'true — «Счёт выставлен»: нужны №, дата и сумма' }) @IsOptional() @IsBoolean() issue?: boolean;
}
