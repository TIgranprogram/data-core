import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsDateString, IsNumber, IsOptional, IsString, MaxLength, Min, ValidateNested } from 'class-validator';
import { IsObjectId } from '../../common/decorators/is-object-id.decorator';

export class ShipmentLineDto {
  @ApiProperty({ description: 'id позиции заказа (incomes)' }) @IsObjectId() incomeId!: string;
  @ApiProperty({ description: 'Сколько отгружено сейчас (> 0, не больше остатка)' }) @IsNumber() @Min(0.001) qty!: number;
}

/** Новая отгрузка: ГГГГ-ММ-ДД (умолч. сегодня), строки, причина (обязательна, если отгружен не весь остаток). */
export class CreateShipmentDto {
  @ApiPropertyOptional() @IsOptional() @IsDateString() date?: string;
  @ApiProperty({ type: [ShipmentLineDto] }) @IsArray() @ArrayMinSize(1, { message: 'Выберите хотя бы одну позицию' }) @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => ShipmentLineDto) lines!: ShipmentLineDto[];
  @ApiPropertyOptional({ description: 'Почему отгружено не всё' }) @IsOptional() @IsString() @MaxLength(500) reason?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) note?: string;
  @ApiPropertyOptional({ description: '№ документа (УПД / ТН)' }) @IsOptional() @IsString() @MaxLength(100) docNo?: string;
  @ApiPropertyOptional({ description: 'Кто принял' }) @IsOptional() @IsString() @MaxLength(200) receiver?: string;
}

export class UpdateShipmentDto {
  @ApiPropertyOptional() @IsOptional() @IsDateString() date?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) note?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) docNo?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) receiver?: string;
}
