import {
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class CreateComplianceRuleDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsString()
  @IsNotEmpty()
  sourceType!: string;

  @IsString()
  @IsNotEmpty()
  targetType!: string;

  @IsString()
  @IsNotEmpty()
  field!: string;

  @IsOptional()
  @IsString()
  fieldLabel?: string;

  @IsIn(['==', '!=', '<', '<=', '>', '>=', 'in', 'notIn', 'matches'])
  operator!:
    | '=='
    | '!='
    | '<'
    | '<='
    | '>'
    | '>='
    | 'in'
    | 'notIn'
    | 'matches';

  @IsOptional()
  @IsString()
  expectedValue?: string;

  @IsOptional()
  @IsString()
  expectedValueMax?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  tolerance?: number;

  @IsOptional()
  @IsString()
  unit?: string;

  @IsOptional()
  @IsIn(['info', 'warning', 'error'])
  severity?: 'info' | 'warning' | 'error';

  @IsOptional()
  sortOrder?: number;
}
