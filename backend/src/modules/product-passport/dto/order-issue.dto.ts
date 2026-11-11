import { ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsIn, IsMongoId, IsOptional } from 'class-validator';

/** Выпуск паспортов на весь заказ (ПНЗ): все готовые позиции или только выбранные. */
export class OrderIssueDto {
  @ApiPropertyOptional({ description: 'id позиций заказа (incomes); нет — все готовые', type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(200) @IsMongoId({ each: true, message: 'lines: неверный id позиции' }) lines?: string[];
  @ApiPropertyOptional({ enum: ['short', 'full'], description: 'вариант паспорта для проверки готовности' }) @IsOptional() @IsIn(['short', 'full']) variant?: 'short' | 'full';
  @ApiPropertyOptional({ description: 'Наша фирма для этого выпуска, если в заказе её ещё нет (C075). В заказ само не пишется.' }) @IsOptional() @IsMongoId({ message: 'supplierOrgId: неверный id фирмы' }) supplierOrgId?: string;
}
