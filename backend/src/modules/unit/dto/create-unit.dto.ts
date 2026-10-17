import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Min,
} from 'class-validator';

export class CreateUnitDto {
  @IsString()
  @Length(1, 32)
  @Matches(/^[a-zA-Z0-9_\-°²³µ¼½¾¼²³·\.\/]+$/, {
    message: 'Ключ может содержать только латиницу, цифры и спец-символы единиц',
  })
  key!: string;

  @IsString()
  @Length(1, 128)
  label!: string;

  @IsOptional()
  @IsString()
  @Length(1, 16)
  symbol?: string;

  @IsOptional()
  @IsString()
  @Length(1, 32)
  category?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsBoolean()
  isSystem?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}
