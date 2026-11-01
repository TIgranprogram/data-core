import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsOptional, Max, Min, ValidateNested } from 'class-validator';
import { IsObjectId } from '../../common/decorators/is-object-id.decorator';
import { QR_TYPES } from './qr-code';

export const QR_PRINT_MAX = 350;

export class QrPrintItemDto {
  @ApiProperty({ enum: QR_TYPES, description: 'S — позиция склада (id из /stock/items), P — изделие, M — материал' })
  @IsIn(QR_TYPES as unknown as string[], { message: 'Тип — S, M или P' }) type!: 'S' | 'M' | 'P';
  @ApiProperty() @IsObjectId() id!: string;
}

export class QrPrintDto {
  @ApiProperty({ type: [QrPrintItemDto], description: `не больше ${QR_PRINT_MAX}` })
  @IsArray() @ArrayMinSize(1, { message: 'Выберите хотя бы одну позицию' }) @ArrayMaxSize(QR_PRINT_MAX, { message: `За раз — не больше ${QR_PRINT_MAX} наклеек` })
  @ValidateNested({ each: true }) @Type(() => QrPrintItemDto) items!: QrPrintItemDto[];
  @ApiPropertyOptional({ description: 'сколько ячеек первого листа пропустить (начатый лист), 0–34' })
  @IsOptional() @IsInt() @Min(0) @Max(34) skip?: number;
}
