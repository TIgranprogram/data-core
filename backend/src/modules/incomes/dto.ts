import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsInt, IsMongoId, IsNumber, IsOptional, IsString, Length, Min, ValidateIf, ValidateNested } from 'class-validator';

/** Платёж по позиции заказа. */
export class PaymentDto {
  @ApiPropertyOptional({ description: 'Дата платежа ГГГГ-ММ-ДД / ДД.ММ.ГГГГ' }) @IsString() @Length(1, 30) date!: string;
  @ApiPropertyOptional({ description: 'Сумма, ₽ (> 0)' }) @IsNumber() @Min(0.01) amount!: number;
  @ApiPropertyOptional({ description: 'Способ: нал | безнал | карта' }) @IsOptional() @IsString() @Length(0, 50) method?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 300) note?: string;
  @ApiPropertyOptional({ description: 'Ключ клиента — повтор POST /incomes/:id/payments не добавляет второй платёж' }) @IsOptional() @IsString() @Length(1, 100) clientUid?: string;
}

/** Доход (строка заказа). Числа: null — очистить поле. Даты: ГГГГ-ММ-ДД / ДД.ММ.ГГГГ, '' — очистить. */
export class IncomeDto {
  @ApiPropertyOptional({ description: 'Заказ (salesorders) — поля шапки (№, заказчик, компания, форма оплаты, отгрузка) берутся из него; null — отвязать', nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsMongoId() orderId?: string | null;
  @ApiPropertyOptional({ description: '№ позиции в заказе (умолч. — следующий)', nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsInt() @Min(0) lineNo?: number | null;
  @ApiPropertyOptional({ description: '№ заказа' }) @IsOptional() @IsString() @Length(0, 50) orderNo?: string;
  @ApiPropertyOptional({ description: 'Заказчик' }) @IsOptional() @IsString() @Length(0, 300) customer?: string;
  @ApiPropertyOptional({ description: 'Наша компания по id (organizations)' }) @IsOptional() @IsMongoId() companyId?: string;
  @ApiPropertyOptional({ description: 'Наша компания по названию: СИЮ / ССЮ' }) @IsOptional() @IsString() @Length(0, 200) companyName?: string;
  @ApiPropertyOptional({ description: 'Форма оплаты: б/р, нал…' }) @IsOptional() @IsString() @Length(0, 50) paymentForm?: string;
  @ApiPropertyOptional({ description: 'Наименование (обязательно при создании)' }) @IsOptional() @IsString() @Length(1, 500) title?: string;
  @ApiPropertyOptional({ description: 'Изделие из «Продукции» (products); не указано при создании — подбирается по названию; null — отвязать', nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsMongoId() productId?: string | null;
  @ApiPropertyOptional({ description: 'Размер (вариант изделия)' }) @IsOptional() @IsString() @Length(0, 100) size?: string;
  @ApiPropertyOptional() @IsOptional() @ValidateIf((_, v) => v !== null) @IsNumber() @Min(0) qty?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 30) unit?: string;
  @ApiPropertyOptional({ description: 'Вид' }) @IsOptional() @IsString() @Length(0, 100) kind?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 100) color?: string;
  @ApiPropertyOptional({ description: 'Цена за единицу' }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsNumber() @Min(0) unitPrice?: number | null;
  @ApiPropertyOptional({ description: 'Доход вручную (важнее кол-во × цена)' }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsNumber() @Min(0) amountManual?: number | null;
  @ApiPropertyOptional({ description: 'Дата отгрузки' }) @IsOptional() @IsString() @Length(0, 30) shipDate?: string;
  @ApiPropertyOptional({ description: 'Дата оплаты' }) @IsOptional() @IsString() @Length(0, 30) paidDate?: string;
  @ApiPropertyOptional({ description: 'Платежи (заменяют весь список). paidDate без payments = оплачено целиком (старый способ); paidDate "" — снять оплату', type: [PaymentDto] }) @IsOptional() @IsArray() @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => PaymentDto) payments?: PaymentDto[];
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 2000) notes?: string;
  @ApiPropertyOptional({ description: 'Ключ клиента — повтор не создаёт дубль' }) @IsOptional() @IsString() @Length(1, 100) clientUid?: string;
}
