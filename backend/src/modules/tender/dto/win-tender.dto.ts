import { IsDateString, IsNumber, IsOptional, Min } from 'class-validator';

export class WinTenderDto {
  @IsNumber() @Min(0) ourPrice!: number;
  @IsOptional() @IsDateString() resultDate?: string;
}
