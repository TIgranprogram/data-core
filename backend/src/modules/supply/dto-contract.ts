import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsIn, IsMongoId, IsNumber, IsOptional, IsString, Length, Min } from 'class-validator';

export class CreateSupplierContractDto {
  @ApiProperty({ description: 'Поставщик (id организации)' }) @IsMongoId() supplierId!: string;
  @ApiProperty({ description: '№ договора' }) @IsString() @Length(1, 100) no!: string;
  @ApiProperty({ description: 'Дата договора ГГГГ-ММ-ДД или ДД.ММ.ГГГГ' }) @IsString() @Length(1, 30) date!: string;
  @ApiPropertyOptional({ description: 'Предмет договора' }) @IsOptional() @IsString() @Length(0, 300) subject?: string;
  @ApiPropertyOptional({ description: 'Действует до; "" — без срока' }) @IsOptional() @IsString() @Length(0, 30) validTo?: string;
  @ApiPropertyOptional({ description: 'Сумма, ₽ (справочно)' }) @IsOptional() @IsNumber() @Min(0) amount?: number;
  @ApiPropertyOptional({ description: 'Файлы договора (id из POST /api/photos/upload)', type: [String] })
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsMongoId({ each: true }) fileIds?: string[];
  @ApiPropertyOptional({ enum: ['active', 'closed'] }) @IsOptional() @IsIn(['active', 'closed']) status?: 'active' | 'closed';
}

/** Поставщика у договора менять нельзя — его нет в PATCH. */
export class PatchSupplierContractDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 100) no?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 30) date?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 300) subject?: string;
  @ApiPropertyOptional({ description: '"" — без срока' }) @IsOptional() @IsString() @Length(0, 30) validTo?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) amount?: number;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(20) @IsMongoId({ each: true }) fileIds?: string[];
  @ApiPropertyOptional({ enum: ['active', 'closed'] }) @IsOptional() @IsIn(['active', 'closed']) status?: 'active' | 'closed';
}
