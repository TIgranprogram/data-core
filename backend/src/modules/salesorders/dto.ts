import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsBoolean, ValidateIf, ValidateNested, ArrayMaxSize, IsIn, IsMongoId, IsOptional, IsString, Length } from 'class-validator';
import { ORDER_PRIORITIES, ORDER_STAGES, type OrderPriority, type OrderStage } from '../../common/text/order-key';

/** Шапка заказа заказчика. Даты: ГГГГ-ММ-ДД / ДД.ММ.ГГГГ, '' — очистить; текст '' — очистить. */
export class SalesOrderDto {
  @ApiPropertyOptional({ description: '№ договора (обязателен при создании)' }) @IsOptional() @IsString() @Length(0, 50) orderNo?: string;
  @ApiPropertyOptional({ description: 'Наша компания по id (organizations)' }) @IsOptional() @IsMongoId() companyId?: string;
  @ApiPropertyOptional({ description: 'Наша компания по названию: СИЮ / ССЮ; "" — без компании' }) @IsOptional() @IsString() @Length(0, 200) companyName?: string;
  @ApiPropertyOptional({ description: 'Заказчик' }) @IsOptional() @IsString() @Length(0, 300) customer?: string;
  @ApiPropertyOptional({ description: 'Предмет заказа / контракта' }) @IsOptional() @IsString() @Length(0, 1000) title?: string;
  @ApiPropertyOptional({ description: 'Форма оплаты: б/р, б/р 30%, нал…' }) @IsOptional() @IsString() @Length(0, 50) paymentForm?: string;
  @ApiPropertyOptional({ description: '№ госконтракта' }) @IsOptional() @IsString() @Length(0, 100) contractNo?: string;
  @ApiPropertyOptional({ description: '№ заказа (производства), например 21-26; один № у нескольких договоров — один заказ; "" снимает' }) @IsOptional() @IsString() @Length(0, 50) productionNo?: string;
  @ApiPropertyOptional({ description: 'Дата контракта' }) @IsOptional() @IsString() @Length(0, 30) contractDate?: string;
  @ApiPropertyOptional({ description: 'Дата отгрузки' }) @IsOptional() @IsString() @Length(0, 30) shipDate?: string;
  @ApiPropertyOptional({ description: 'Срок изготовления' }) @IsOptional() @IsString() @Length(0, 30) productionDeadline?: string;
  @ApiPropertyOptional({ description: 'Окончание поставки' }) @IsOptional() @IsString() @Length(0, 30) deliveryDeadline?: string;
  @ApiPropertyOptional({ enum: ORDER_STAGES, description: 'new | production | ready | partly | shipped | closed | cancelled' }) @IsOptional() @IsIn(ORDER_STAGES as unknown as string[]) stage?: OrderStage;
  @ApiPropertyOptional({ enum: ORDER_PRIORITIES, description: 'urgent | high | normal | low; "" — снять (= обычный)' }) @IsOptional() @IsIn([...ORDER_PRIORITIES, '']) priority?: OrderPriority | '';
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 5000) notes?: string;
  @ApiPropertyOptional({ description: 'Ключ клиента — повтор не создаёт дубль' }) @IsOptional() @IsString() @Length(1, 100) clientUid?: string;
}

export class MatchPickDto {
  @ApiPropertyOptional() @IsMongoId() lineId!: string;
  @ApiPropertyOptional({ description: 'null — оставить без изделия' }) @ValidateIf((_, v) => v !== null) @IsMongoId() productId!: string | null;
}

/** ПРЖ-4: подбор изделий для позиций заказа. */
export class MatchProductsDto {
  @ApiPropertyOptional({ description: 'true — записать picks; иначе только предложения' }) @IsOptional() @IsBoolean() apply?: boolean;
  @ApiPropertyOptional({ type: [MatchPickDto] }) @IsOptional() @IsArray() @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => MatchPickDto) picks?: MatchPickDto[];
}

/** Этап «ко всем договорам» заказа производства. */
export class ProductionStageDto {
  @ApiPropertyOptional({ enum: ORDER_STAGES, description: "new | production | ready | partly | shipped | closed" }) @IsIn(ORDER_STAGES as unknown as string[]) stage!: OrderStage;
}

/** Привязка договоров без № к заказу производства. Без `productionNo` — новый заказ. */
export class AssignOrdersDto {
  @ApiPropertyOptional({ description: 'id договоров без № заказа' }) @IsArray() @ArrayMaxSize(200) @IsMongoId({ each: true }) contractIds!: string[];
  @ApiPropertyOptional({ description: '№ существующего заказа; нет — создаётся новый' }) @IsOptional() @IsString() @Length(0, 50) productionNo?: string;
}
