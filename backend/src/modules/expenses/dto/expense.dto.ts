import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsMongoId, IsNumber, IsOptional, IsString, Length, Matches, Min } from 'class-validator';

export class CreateExpenseDto {
  @ApiProperty({ description: 'Дата оплаты ГГГГ-ММ-ДД' }) @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Дата — в формате ГГГГ-ММ-ДД' }) date!: string;
  @ApiProperty({ description: 'Сумма, ₽ (больше нуля)' }) @IsNumber({}, { message: 'Сумма — число' }) @Min(0.01, { message: 'Сумма больше нуля' }) amount!: number;
  @ApiProperty({ description: 'Наша фирма (organizations.id)' }) @IsMongoId({ message: 'Выберите фирму' }) companyId!: string;
  @ApiProperty({ description: 'Подстатья (expense-articles children.id)' }) @IsMongoId({ message: 'Выберите статью' }) articleId!: string;
  @ApiProperty() @IsString({ message: 'Укажите название' }) @Length(1, 300, { message: 'Название — от 1 до 300 символов' }) title!: string;
  @ApiPropertyOptional({ description: 'Объект — заказ заказчика (salesorders.id); "" — без объекта' }) @IsOptional() @IsString() @Length(0, 30) salesOrderId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 200, { message: 'Контрагент — до 200 символов' }) counterpartyName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 100, { message: '№ документа — до 100 символов' }) docNo?: string;
  @ApiPropertyOptional({ type: [String], description: 'Файлы счёта (id из загрузки файлов)' }) @IsOptional() @IsArray() @ArrayMaxSize(20, { message: 'Файлов не больше 20' }) @IsMongoId({ each: true, message: 'Некорректный файл' }) fileIds?: string[];
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 2000, { message: 'Комментарий — до 2000 символов' }) comment?: string;
}

export class UpdateExpenseDto extends PartialType(CreateExpenseDto) {}
