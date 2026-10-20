import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsMongoId, IsNumber, IsOptional, IsString, Length, Min, ValidateIf } from 'class-validator';

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
  @ApiPropertyOptional() @IsOptional() @ValidateIf((_, v) => v !== null) @IsNumber() @Min(0) qty?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 30) unit?: string;
  @ApiPropertyOptional({ description: 'Вид' }) @IsOptional() @IsString() @Length(0, 100) kind?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 100) color?: string;
  @ApiPropertyOptional({ description: 'Цена за единицу' }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsNumber() @Min(0) unitPrice?: number | null;
  @ApiPropertyOptional({ description: 'Доход вручную (важнее кол-во × цена)' }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsNumber() @Min(0) amountManual?: number | null;
  @ApiPropertyOptional({ description: 'Дата отгрузки' }) @IsOptional() @IsString() @Length(0, 30) shipDate?: string;
  @ApiPropertyOptional({ description: 'Дата оплаты' }) @IsOptional() @IsString() @Length(0, 30) paidDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 2000) notes?: string;
  @ApiPropertyOptional({ description: 'Ключ клиента — повтор не создаёт дубль' }) @IsOptional() @IsString() @Length(1, 100) clientUid?: string;
}
