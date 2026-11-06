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
  @ApiPropertyOptional({ description: 'Объект (печатается под заказчиком)' }) @IsOptional() @IsString() @MaxLength(500) objectName?: string;
  @ApiPropertyOptional({ enum: ['with', 'without'], description: 'НДС; пусто — по ставке нашей фирмы' }) @IsOptional() @IsIn(['with', 'without'], { message: 'НДС — «с НДС» или «без НДС»' }) vatMode?: 'with' | 'without';
  @ApiPropertyOptional({ description: 'Ставка НДС, %; пусто — ставка фирмы (нет — 22)' }) @IsOptional() @IsNumber() @Min(0) @Max(30) vatRate?: number;
  @ApiPropertyOptional({ enum: ['included', 'excluded'], description: 'Доставка до объекта; пусто — строку не печатаем' }) @IsOptional() @IsIn(['included', 'excluded'], { message: 'Доставка — «включена» или «не включена»' }) delivery?: 'included' | 'excluded';
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(3000) terms?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) notes?: string;
  @ApiPropertyOptional({ description: 'Фон стр. 1: id из GET /offers/backgrounds; пусто — по умолчанию' }) @IsOptional() @Matches(BG_ID, { message: 'Некорректный фон' }) bg1Id?: string;
  @ApiPropertyOptional({ description: 'Фон стр. 2+: id; «none» — белая; пусто — по умолчанию' }) @IsOptional() @Matches(BG_ID, { message: 'Некорректный фон' }) bg2Id?: string;
}

/** Правка: любые поля из создания; статус меняется только через POST :id/status. */
export class UpdateOfferDto extends PartialType(CreateOfferDto) {
  @ApiPropertyOptional({ description: 'Причина (от 3 символов) — нужна администратору для правки оплаченного КП; уходит в журнал' }) @IsOptional() @IsString() @MaxLength(500) reason?: string;
}

export class OfferStatusDto {
  @ApiProperty({ enum: OFFER_STATUSES }) @IsIn(OFFER_STATUSES as unknown as string[], { message: 'Неизвестный статус' }) status!: string;
  @ApiPropertyOptional({ description: 'Причина (от 3 символов) — нужна администратору для перехода, который остальным закрыт; уходит в журнал' }) @IsOptional() @IsString() @MaxLength(500) reason?: string;
}

/** Подтверждение заказа из КП (этап 2): номера можно переопределить. */
export class OfferCreateOrderDto {
  @ApiPropertyOptional({ description: '№ договора; по умолчанию — из номера КП' }) @IsOptional() @IsString() @MaxLength(50) orderNo?: string;
  @ApiPropertyOptional({ description: '№ заказа на производство; по умолчанию — следующий свободный' }) @IsOptional() @IsString() @MaxLength(50) productionNo?: string;
}

/** Поля зоны текста и стандартных текстов бланка (общие для загрузки и правки). */
const emptyToUndef = ({ value }: { value: unknown }) => (value === '' ? undefined : value);

export class UploadBackgroundDto {
  @ApiProperty() @IsString() @MaxLength(100) name!: string;
  @ApiProperty({ enum: [1, 2], description: '1 — первая страница, 2 — вторая и следующие' }) @Type(() => Number) @IsInt() @IsIn([1, 2], { message: 'Страница — 1 или 2' }) page!: number;
  @ApiPropertyOptional({ description: 'Наша компания: бланк этой компании; пусто — общий фон' }) @IsOptional() @IsObjectId() companyId?: string;
  @ApiPropertyOptional({ description: 'Сделать фоном по умолчанию для этой страницы' }) @IsOptional() @Transform(({ value }) => value === true || value === 'true' || value === '1') @IsBoolean() isDefault?: boolean;
  @ApiPropertyOptional({ description: 'Верх зоны текста, доля высоты 0–0.6; пусто — как раньше' }) @IsOptional() @Transform(emptyToUndef) @Type(() => Number) @IsNumber() @Min(0, { message: 'Верх текста — от 0 до 60 %' }) @Max(0.6, { message: 'Верх текста — от 0 до 60 %' }) textTop?: number;
  @ApiPropertyOptional({ description: 'Низ зоны текста, доля высоты 0.4–0.95; пусто — как раньше' }) @IsOptional() @Transform(emptyToUndef) @Type(() => Number) @IsNumber() @Min(0.4, { message: 'Низ текста — от 40 до 95 %' }) @Max(0.95, { message: 'Низ текста — от 40 до 95 %' }) textBottom?: number;
  @ApiPropertyOptional({ description: 'Стандартные тексты фирмы (подставляются в «Условия» нового КП)' }) @IsOptional() @IsString() @MaxLength(3000) defaultTerms?: string;
}

/** Правка бланка; null в textTop / textBottom / defaultTerms — сбросить. */
export class UpdateBackgroundDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @IsNotEmpty({ message: 'Название не может быть пустым' }) @MaxLength(100) name?: string;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsNumber() @Min(0, { message: 'Верх текста — от 0 до 60 %' }) @Max(0.6, { message: 'Верх текста — от 0 до 60 %' }) textTop?: number | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsNumber() @Min(0.4, { message: 'Низ текста — от 40 до 95 %' }) @Max(0.95, { message: 'Низ текста — от 40 до 95 %' }) textBottom?: number | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsString() @MaxLength(3000) defaultTerms?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isDefault?: boolean;
}

/** Копия КП для другой нашей фирмы с наценкой. */
export class OfferCopyDto {
  @ApiProperty({ description: 'Наша компания, для которой делаем копию' }) @IsObjectId() companyId!: string;
  @ApiPropertyOptional({ default: 0, description: 'Наценка на цены строк, % (−50…100); цена округляется до рубля' }) @IsOptional() @IsNumber() @Min(-50, { message: 'Наценка — от −50 до 100 %' }) @Max(100, { message: 'Наценка — от −50 до 100 %' }) markupPercent?: number;
}

/** Показать/скрыть фирму в «Деньгах»: «только для КП» — в доходах, расходах, календаре её нет. */
export class OfferCompanyDto {
  @ApiProperty() @IsBoolean() offersOnly!: boolean;
}
