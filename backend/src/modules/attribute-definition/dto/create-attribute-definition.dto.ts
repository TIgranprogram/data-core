import { IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { Type } from 'class-transformer';
import { IsObjectId } from '../../../common/decorators/is-object-id.decorator';


export class CreateAttributeDefinitionDto {
  @IsString()
  @IsNotEmpty()
  entityType!: string;

  @IsOptional()
  @IsObjectId()
  categoryId?: string;

  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsNotEmpty()
  label!: string;

  @IsIn(['string', 'number', 'date', 'enum', 'boolean'])
  type!: 'string' | 'number' | 'date' | 'enum' | 'boolean';

  @IsOptional()
  @IsString()
  unit?: string;

  @IsOptional()
  @Type(() => String)
  options?: string[];

  @IsOptional()
  @IsBoolean()
  required?: boolean;

  @IsOptional()
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsString()
  description?: string;
}
