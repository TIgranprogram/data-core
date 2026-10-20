import { ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsDateString, IsMongoId, IsNumber, IsOptional, IsString, Length, Min } from 'class-validator';

export class SupplyRequestDto {
  @ApiPropertyOptional({ description: 'Наименование' }) @IsOptional() @IsString() @Length(0, 500) title?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) qty?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 30) unit?: string;
  @ApiPropertyOptional({ description: '№ заявки (пусто — следующий)' }) @IsOptional() @IsNumber() num?: number;
  @ApiPropertyOptional({ description: 'Дата заявки, ISO' }) @IsOptional() @IsDateString() requestDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsMongoId() categoryId?: string;
  @ApiPropertyOptional({ description: 'Категория по названию (создаётся, если нет)' }) @IsOptional() @IsString() @Length(0, 100) categoryName?: string;
  @ApiPropertyOptional({ description: 'Позиция склада (материал)' }) @IsOptional() @IsMongoId() materialId?: string;
  @ApiPropertyOptional({ description: 'Поставщик по названию (организация создаётся, если нет)' }) @IsOptional() @IsString() @Length(0, 200) supplierName?: string;
  @ApiPropertyOptional({ description: 'Наша компания по названию' }) @IsOptional() @IsString() @Length(0, 200) companyName?: string;
  @ApiPropertyOptional({ description: 'Заказчик / участок' }) @IsOptional() @IsString() @Length(0, 300) orderLabel?: string;
  @ApiPropertyOptional({ description: 'Заказ заказчика (salesorders.id); "" — отвязать' }) @IsOptional() @IsString() @Length(0, 30) salesOrderId?: string;
  @ApiPropertyOptional({ description: 'Позиция заказа (incomes.id); "" — без позиции' }) @IsOptional() @IsString() @Length(0, 30) salesOrderLineId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 200) requestedBy?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 100) article?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 100) color?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 1000) productUrl?: string;
  @ApiPropertyOptional({ description: 'Цена с НДС' }) @IsOptional() @IsNumber() @Min(0) priceHint?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 100) invoiceNo?: string;
  @ApiPropertyOptional({ description: 'Тип счёта: Счет на оплату, Счет-договор, УПД… (хранится в sheetExtra.invoiceType)' }) @IsOptional() @IsString() @Length(0, 60) invoiceType?: string;
  @ApiPropertyOptional({ description: 'Дата счёта ГГГГ-ММ-ДД; пустая строка — очистить' }) @IsOptional() @IsString() @Length(0, 30) invoiceDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 300) deliveryNote?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 2000) notes?: string;
  @ApiPropertyOptional({ description: '⏳ Ожидает / ✅ Заказать / ⚙️ В работе / 💰 Оплачено / ☑️ Получено / ❌ Отменено' }) @IsOptional() @IsString() @Length(0, 40) statusLabel?: string;
  @ApiPropertyOptional({ description: 'Срочно / Обычный / Низко' }) @IsOptional() @IsString() @Length(0, 40) priorityLabel?: string;
  @ApiPropertyOptional({ description: 'Фото заявки (id из POST /api/photos/upload) — весь список, по порядку; [] — убрать все', type: [String] })
  @IsOptional() @IsArray() @ArrayMaxSize(30) @IsMongoId({ each: true }) photoIds?: string[];
  @ApiPropertyOptional({ description: 'Ключ клиента — повтор не создаёт дубль' }) @IsOptional() @IsString() @Length(1, 100) clientUid?: string;
}

export class SupplyPhotoDto {
  @ApiPropertyOptional({ description: 'id из POST /api/photos/upload' }) @IsMongoId() photoId!: string;
}

export class SupplyReceiveDto {
  @ApiPropertyOptional({ description: 'Получено (по умолчанию — количество в заявке)' }) @IsOptional() @IsNumber() @Min(0) qty?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 100) clientUid?: string;
}
