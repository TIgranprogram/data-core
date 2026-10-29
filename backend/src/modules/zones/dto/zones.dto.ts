import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsBoolean, IsInt, IsMongoId, IsOptional, IsString, Matches, MaxLength, ValidateIf } from 'class-validator';

export class CreateZoneDto {
  @ApiProperty({ description: 'Код: латиница, цифры и «_»; после создания не меняется' }) @IsString() @Matches(/^[a-z][a-z0-9_]{1,29}$/, { message: 'Код зоны — латиница, цифры и «_», от 2 до 30 знаков' }) code!: string;
  @ApiProperty() @IsString() @MaxLength(40, { message: 'Название зоны — не длиннее 40 знаков' }) name!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) hint?: string;
}

export class UpdateZoneDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40, { message: 'Название зоны — не длиннее 40 знаков' }) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) hint?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() order?: number;
  @ApiPropertyOptional({ description: 'false — скрыть зону' }) @IsOptional() @IsBoolean() active?: boolean;
}

export class PersonZonesDto {
  @ApiProperty({ type: [String], description: 'Коды зон сотрудника (полный список; недостающие снимаются)' }) @IsArray() @ArrayMaxSize(30) @IsString({ each: true }) zoneCodes!: string[];
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) note?: string;
}

export class PersonUserDto {
  @ApiProperty({ nullable: true, description: 'Пользователь (users._id); null — снять связь' }) @ValidateIf((_o, v) => v !== null) @IsMongoId() userId!: string | null;
}
