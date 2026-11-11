import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsMongoId, IsNotEmpty, IsOptional, Matches } from 'class-validator';

/** Готовый паспорт (C072): поля формы multipart вместе с файлом `file` (PDF). Всё приходит строками. */
export class ReadyPassportDto {
  @ApiProperty({ description: 'Изделие (обязательно)' }) @IsNotEmpty({ message: 'Выберите изделие' }) @IsMongoId({ message: 'productId: неверный id изделия' }) productId!: string;
  @ApiProperty({ description: 'Наша фирма (обязательно)' }) @IsNotEmpty({ message: 'Выберите фирму' }) @IsMongoId({ message: 'supplierOrgId: неверный id фирмы' }) supplierOrgId!: string;
  @ApiPropertyOptional({ description: 'Заказ' }) @IsOptional() @IsMongoId({ message: 'salesOrderId: неверный id заказа' }) salesOrderId?: string;
  @ApiPropertyOptional({ description: 'Позиция заказа (на неё один живой паспорт)' }) @IsOptional() @IsMongoId({ message: 'incomeId: неверный id позиции' }) incomeId?: string;
  @ApiPropertyOptional({ description: '№ паспорта из файла; нет — следующий свободный', example: '612' }) @IsOptional() @Matches(/^\d{1,9}$/, { message: 'Номер — целое число, например 612' }) number?: string;
}
