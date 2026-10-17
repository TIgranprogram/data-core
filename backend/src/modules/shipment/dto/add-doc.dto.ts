import { IsArray, IsDateString, IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class AddDocDto {
  @IsString() @IsNotEmpty()
  type!: string; // 'ttn' | 'upd' | 'cmr' | 'invoice' | 'other'

  @IsNumber() @Min(0)
  totalAmount!: number;

  @IsOptional() @IsDateString() date?: string;

  @IsOptional() @IsString() number?: string;
  @IsOptional() @IsString() pdfUrl?: string;
  @IsOptional() @IsString() notes?: string;

  @IsOptional() @IsArray() @IsString({ each: true }) signatures?: string[];
}
