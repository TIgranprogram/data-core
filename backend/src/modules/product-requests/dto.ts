import { ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsMongoId, IsOptional, IsString, Length } from 'class-validator';

/** Создать заявку из позиции заказа (`incomeId`) или по названию; одно название — одна открытая заявка. */
export class CreateProductRequestDto {
  @ApiPropertyOptional({ description: 'Позиция заказа (incomes): она станет «Новым изделием» и привяжется к заявке (нужны количество и цена)' }) @IsOptional() @IsMongoId() incomeId?: string;
  @ApiPropertyOptional({ description: 'Название (если нет incomeId)' }) @IsOptional() @IsString() @Length(1, 500) title?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 2000) description?: string;
  @ApiPropertyOptional({ description: 'Фото (photos)', type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(20) @IsMongoId({ each: true }) photoIds?: string[];
}

/** «Это дубль»: позиции заявки переходят на существующее изделие. */
export class RejectProductRequestDto {
  @ApiPropertyOptional({ description: 'Существующее изделие (products)' }) @IsMongoId() productId!: string;
}
