import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { IsObjectId } from '../../../common/decorators/is-object-id.decorator';

export class CreateWarehouseDto {
  @ApiProperty({ example: 'Основной склад', description: 'Название склада' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiPropertyOptional({
    enum: ['main', 'branch', 'transit', 'production', 'other'],
    description: 'Тип склада',
  })
  @IsOptional()
  @IsIn(['main', 'branch', 'transit', 'production', 'other'])
  type?: 'main' | 'branch' | 'transit' | 'production' | 'other';

  @ApiPropertyOptional({ description: 'Адрес склада' })
  @IsOptional() @IsString() address?: string;
  @ApiPropertyOptional({ description: 'Описание' })
  @IsOptional() @IsString() description?: string;
  @ApiPropertyOptional({ description: 'Активен ли склад' })
  @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional({ description: 'Склад по умолчанию (ровно один; сервер снимает флаг с остальных)' })
  @IsOptional() @IsBoolean() isDefault?: boolean;
  @ApiPropertyOptional({ type: [String], description: 'Названия зон' })
  @IsOptional() @IsArray() zoneNames?: string[];

  @ApiPropertyOptional({ type: [String], description: 'ID ролей с доступом к складу' })
  @IsOptional()
  @IsArray()
  @IsObjectId({ each: true })
  roleIds?: string[];
}
