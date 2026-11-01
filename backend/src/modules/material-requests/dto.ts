import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsMongoId, IsNumber, IsOptional, IsString, Length, Max, Min } from 'class-validator';

export class CreateMaterialRequestDto {
  @ApiProperty({ description: 'Что нужно завести (свободный текст)' }) @IsString() @Length(1, 500) text!: string;
  @ApiPropertyOptional({ description: 'Сколько нужно (необязательно)' }) @IsOptional() @IsNumber() @Min(0) @Max(1000000) qty?: number;
  @ApiPropertyOptional({ description: 'Склад (stockzones); чужой склад — 403' }) @IsOptional() @IsMongoId() zoneId?: string;
}

export class CloseMaterialRequestDto {
  @ApiProperty({ enum: ['done', 'rejected'] }) @IsIn(['done', 'rejected']) status!: 'done' | 'rejected';
  @ApiPropertyOptional({ description: 'Созданная позиция склада (при done)' }) @IsOptional() @IsMongoId() materialId?: string;
}
