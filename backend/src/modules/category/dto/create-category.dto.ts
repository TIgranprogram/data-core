import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsMongoId,
  IsOptional,
  IsString,
  Length,
  Matches,
} from 'class-validator';

export class CreateCategoryDto {
  @ApiProperty({ example: 'Металлопрокат', description: 'Название категории' })
  @IsString()
  @Length(1, 128)
  name!: string;

  @ApiProperty({ example: 'metalloprokat', description: 'Slug (строчные, a-z, 0-9, -)' })
  @IsString()
  @Length(1, 64)
  @Matches(/^[a-z0-9-]+$/, { message: 'slug must be lowercase, a-z, 0-9, -' })
  slug!: string;

  @ApiProperty({ enum: ['material', 'product', 'module', 'general'], description: 'Тип категории' })
  @IsIn(['material', 'product', 'module', 'general'])
  type!: 'material' | 'product' | 'module' | 'general';

  @ApiPropertyOptional({ description: 'ID родительской категории' })
  @IsOptional()
  @IsMongoId()
  parentId?: string;

  @ApiProperty({ example: 'MPT', description: 'Префикс SKU (верхний регистр, A-Z, 0-9, -)' })
  @IsString()
  @Length(1, 16)
  @Matches(/^[A-Z0-9-]+$/, { message: 'skuPrefix must be uppercase A-Z, 0-9, -' })
  skuPrefix!: string;

  @ApiPropertyOptional({ description: 'Описание категории' })
  @IsOptional() @IsString() @Length(0, 512) description?: string;
  @ApiPropertyOptional({ description: 'Активна ли категория' })
  @IsOptional() @IsBoolean() isActive?: boolean;
}
