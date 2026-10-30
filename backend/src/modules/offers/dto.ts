import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, Matches, MaxLength, Min, Max, ValidateNested } from 'class-validator';
import { IsObjectId } from '../../common/decorators/is-object-id.decorator';
import { OFFER_STATUSES } from './offer.schema';

export class OfferItemDto {
  @ApiPropertyOptional({ description: 'id изделия каталога' }) @IsOptional() @IsObjectId() productId?: string;
  @ApiProperty() @IsString() @IsNotEmpty({ message: 'Укажите название строки' }) @MaxLength(300, { message: 'Название строки — не длиннее 300 знаков' }) productName!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) productSku?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) description?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) color?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) size?: string;
  @ApiPropertyOptional({ description: '/uploads/…' }) @IsOptional() @IsString() @MaxLength(500) photoUrl?: string;
  @ApiProperty() @IsNumber() @Min(0.001, { message: 'Количество должно быть больше нуля' }) quantity!: number;
  @ApiPropertyOptional({ default: 'шт' }) @IsOptional() @IsString() @MaxLength(20) unit?: string;
  @ApiPropertyOptional({ description: 'Цена за единицу; для статуса «Отправлено» обязательна' }) @IsOptional() @IsNumber() @Min(0) unitPrice?: number;
}

const BG_ID = /^([a-f\d]{24}|builtin-[12]|none)$/i;

export class CreateOfferDto {
  @ApiProperty({ description: 'Наша компания (organizations)' }) @IsObjectId() companyId!: string;
  @ApiProperty() @IsString() @IsNotEmpty({ message: 'Укажите заказчика' }) @MaxLength(300) customer!: string;
  @ApiPropertyOptional() @IsOptional() @IsObjectId() counterpartyId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) title?: string;
  @ApiPropertyOptional({ description: 'ГГГГ-ММ-ДД, умолч. сегодня' }) @IsOptional() @IsDateString() date?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() validUntil?: string;
  @ApiProperty({ type: [OfferItemDto] }) @IsArray() @ArrayMinSize(1, { message: 'Добавьте хотя бы одну строку в КП' }) @ArrayMaxSize(300) @ValidateNested({ each: true }) @Type(() => OfferItemDto) items!: OfferItemDto[];
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) @Max(100) prepaymentPercent?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) productionDays?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) deliveryDays?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(3000) terms?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) notes?: string;
  @ApiPropertyOptional({ description: 'Фон стр. 1: id из GET /offers/backgrounds; пусто — по умолчанию' }) @IsOptional() @Matches(BG_ID, { message: 'Некорректный фон' }) bg1Id?: string;
  @ApiPropertyOptional({ description: 'Фон стр. 2+: id; «none» — белая; пусто — по умолчанию' }) @IsOptional() @Matches(BG_ID, { message: 'Некорректный фон' }) bg2Id?: string;
}

/** Правка: любые поля из создания; статус меняется только через POST :id/status. */
export class UpdateOfferDto extends PartialType(CreateOfferDto) {}

export class OfferStatusDto {
  @ApiProperty({ enum: OFFER_STATUSES }) @IsIn(OFFER_STATUSES as unknown as string[], { message: 'Неизвестный статус' }) status!: string;
}

export class UploadBackgroundDto {
  @ApiProperty() @IsString() @MaxLength(100) name!: string;
  @ApiProperty({ enum: [1, 2], description: '1 — первая страница, 2 — вторая и следующие' }) @Type(() => Number) @IsInt() @IsIn([1, 2], { message: 'Страница — 1 или 2' }) page!: number;
  @ApiPropertyOptional({ description: 'Сделать фоном по умолчанию для этой страницы' }) @IsOptional() @Transform(({ value }) => value === true || value === 'true' || value === '1') @IsBoolean() isDefault?: boolean;
}
