import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsMongoId,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Min,
  ValidateNested,
} from 'class-validator';

class CompositionOverrideDimensionsDto {
  @ApiPropertyOptional()
  @IsOptional() @IsNumber() @Min(0)
  length?: number;

  @ApiPropertyOptional()
  @IsOptional() @IsNumber() @Min(0)
  width?: number;

  @ApiPropertyOptional()
  @IsOptional() @IsNumber() @Min(0)
  height?: number;

  @ApiPropertyOptional()
  @IsOptional() @IsString() @Length(1, 32)
  unit?: string;
}

export class CreateCompositionLineDto {
  @ApiProperty({ enum: ['module', 'material', 'product'] })
  @IsIn(['module', 'material', 'product'])
  lineType!: 'module' | 'material' | 'product';

  @ApiProperty()
  @IsMongoId()
  refId!: string;

  @ApiProperty({ minimum: 0.000001 })
  @Type(() => Number)
  @IsNumber()
  @Min(0.000001)
  quantity!: number;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional() @IsNumber() @Min(0)
  sortOrder?: number;

  @ApiPropertyOptional()
  @IsOptional() @IsString() @Length(1, 32)
  unit?: string;

  @ApiPropertyOptional({ type: CompositionOverrideDimensionsDto })
  @IsOptional() @ValidateNested() @Type(() => CompositionOverrideDimensionsDto)
  overrideDimensions?: CompositionOverrideDimensionsDto;

  @ApiPropertyOptional()
  @IsOptional() @IsBoolean()
  isPurchased?: boolean;

  @ApiPropertyOptional()
  @IsOptional() @IsString() @Length(0, 256)
  sourcePosition?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString() @Length(0, 256)
  sourceCode?: string;

  @ApiPropertyOptional({ description: 'Цена переопределения (только для product-lines)' })
  @IsOptional() @IsNumber() @Min(0)
  unitPriceOverride?: number;

  @ApiPropertyOptional()
  @IsOptional() @IsString() @Length(0, 2000)
  notes?: string;
}

export class UpdateCompositionLineDto {
  @ApiPropertyOptional({ enum: ['module', 'material', 'product'] })
  @IsOptional() @IsIn(['module', 'material', 'product'])
  lineType?: 'module' | 'material' | 'product';

  @ApiPropertyOptional()
  @IsOptional() @IsMongoId()
  refId?: string;

  @ApiPropertyOptional({ minimum: 0.000001 })
  @IsOptional() @IsNumber() @Min(0.000001)
  quantity?: number;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional() @IsNumber() @Min(0)
  sortOrder?: number;

  @ApiPropertyOptional()
  @IsOptional() @IsString() @Length(1, 32)
  unit?: string;

  @ApiPropertyOptional({ type: CompositionOverrideDimensionsDto })
  @IsOptional() @ValidateNested() @Type(() => CompositionOverrideDimensionsDto)
  overrideDimensions?: CompositionOverrideDimensionsDto;

  @ApiPropertyOptional()
  @IsOptional() @IsBoolean()
  isPurchased?: boolean;

  @ApiPropertyOptional()
  @IsOptional() @IsString() @Length(0, 256)
  sourcePosition?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString() @Length(0, 256)
  sourceCode?: string;

  @ApiPropertyOptional({ description: 'Цена переопределения (только для product-lines)' })
  @IsOptional() @IsNumber() @Min(0)
  unitPriceOverride?: number;

  @ApiPropertyOptional()
  @IsOptional() @IsString() @Length(0, 2000)
  notes?: string;
}
