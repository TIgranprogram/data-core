import { ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsMongoId, IsOptional } from 'class-validator';
import { PassportPresentationDto } from './presentation.dto';

/** Выпуск паспортов на весь заказ (ПНЗ): все готовые позиции или только выбранные. */
export class OrderIssueDto extends PassportPresentationDto {
  @ApiPropertyOptional({ description: 'id позиций заказа (incomes); нет — все готовые', type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(200) @IsMongoId({ each: true, message: 'lines: неверный id позиции' }) lines?: string[];
  @ApiPropertyOptional({ description: 'Наша фирма для этого выпуска, если в заказе её ещё нет (C075). В заказ само не пишется.' }) @IsOptional() @IsMongoId({ message: 'supplierOrgId: неверный id фирмы' }) supplierOrgId?: string;
}
