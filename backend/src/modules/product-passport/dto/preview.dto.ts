import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsMongoId, IsOptional } from 'class-validator';

/** Предпросмотр PDF паспорта по изделию без выпуска. */
export class PassportPreviewDto {
  @ApiProperty({ description: 'id изделия' }) @IsMongoId({ message: 'productId: неверный id изделия' }) productId!: string;
  @ApiPropertyOptional({ enum: ['pages', 'print'] }) @IsOptional() @IsIn(['pages', 'print']) mode?: 'pages' | 'print';
  @ApiPropertyOptional({ description: 'чёрно-белый' }) @IsOptional() @IsBoolean() bw?: boolean;
  @ApiPropertyOptional({ enum: ['short', 'full'], description: 'short — только обязательное (умолч.); full — плюс необязательные разделы' }) @IsOptional() @IsIn(['short', 'full']) variant?: 'short' | 'full';
}
