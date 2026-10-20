import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsMongoId, IsOptional, IsString, Length } from 'class-validator';
import { ORDER_STAGES, type OrderStage } from './order-key';

/** Шапка заказа заказчика. Даты: ГГГГ-ММ-ДД / ДД.ММ.ГГГГ, '' — очистить; текст '' — очистить. */
export class SalesOrderDto {
  @ApiPropertyOptional({ description: '№ заказа (обязателен при создании)' }) @IsOptional() @IsString() @Length(0, 50) orderNo?: string;
  @ApiPropertyOptional({ description: 'Наша компания по id (organizations)' }) @IsOptional() @IsMongoId() companyId?: string;
  @ApiPropertyOptional({ description: 'Наша компания по названию: СИЮ / ССЮ; "" — без компании' }) @IsOptional() @IsString() @Length(0, 200) companyName?: string;
  @ApiPropertyOptional({ description: 'Заказчик' }) @IsOptional() @IsString() @Length(0, 300) customer?: string;
  @ApiPropertyOptional({ description: 'Предмет заказа / контракта' }) @IsOptional() @IsString() @Length(0, 1000) title?: string;
  @ApiPropertyOptional({ description: 'Форма оплаты: б/р, б/р 30%, нал…' }) @IsOptional() @IsString() @Length(0, 50) paymentForm?: string;
  @ApiPropertyOptional({ description: '№ контракта' }) @IsOptional() @IsString() @Length(0, 100) contractNo?: string;
  @ApiPropertyOptional({ description: 'Дата контракта' }) @IsOptional() @IsString() @Length(0, 30) contractDate?: string;
  @ApiPropertyOptional({ description: 'Дата отгрузки' }) @IsOptional() @IsString() @Length(0, 30) shipDate?: string;
  @ApiPropertyOptional({ description: 'Срок изготовления' }) @IsOptional() @IsString() @Length(0, 30) productionDeadline?: string;
  @ApiPropertyOptional({ description: 'Окончание поставки' }) @IsOptional() @IsString() @Length(0, 30) deliveryDeadline?: string;
  @ApiPropertyOptional({ enum: ORDER_STAGES, description: 'new | production | ready | shipped | closed | cancelled' }) @IsOptional() @IsIn(ORDER_STAGES as unknown as string[]) stage?: OrderStage;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 5000) notes?: string;
  @ApiPropertyOptional({ description: 'Ключ клиента — повтор не создаёт дубль' }) @IsOptional() @IsString() @Length(1, 100) clientUid?: string;
}
