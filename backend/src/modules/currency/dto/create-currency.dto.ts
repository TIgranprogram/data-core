import {
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Matches,
  Min,
} from 'class-validator';

export class CreateCurrencyDto {
  @IsString()
  @Length(1, 8)
  @Matches(/^[A-Z]{2,8}$/, {
    message: 'Key must be 2-8 uppercase letters (ISO 4217 code)',
  })
  key!: string;

  @IsString()
  @Length(1, 128)
  label!: string;

  @IsString()
  @Length(1, 8)
  code!: string;

  @IsString()
  @Length(1, 8)
  symbol!: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  rate?: number;

  @IsOptional()
  @IsBoolean()
  isBase?: boolean;

  @IsOptional()
  @IsString()
  @Length(1, 16)
  locale?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  precision?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsBoolean()
  isSystem?: boolean;
}
