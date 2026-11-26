import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsMongoId, IsObject, IsOptional, IsString, Length } from 'class-validator';
import type { Dims, MetalKind } from './metal';

export class StockCoordinateDto {
  @ApiProperty({ enum: ['pipe', 'sheet'] }) @IsIn(['pipe', 'sheet']) kind!: MetalKind;
  @ApiProperty() @IsMongoId() categoryId!: string;
  @ApiProperty() @IsString() @Length(1, 300) name!: string;
  @ApiProperty() @IsString() @Length(1, 30) unit!: string;
  @ApiProperty({ type: 'object', description: 'Размеры в мм до сотых: длина и толщина; для листа ширина, для трубы диаметр или ширина и высота' }) @IsObject() dims!: Dims;
  @ApiPropertyOptional({ type: Boolean, nullable: true }) @IsOptional() @IsBoolean() washed?: boolean | null;
  @ApiPropertyOptional({ type: String, nullable: true }) @IsOptional() @IsString() @Length(0, 100) materialGrade?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) @IsOptional() @IsString() @Length(0, 200) assortment?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) @IsOptional() @IsString() @Length(0, 120) typeName?: string | null;
}
