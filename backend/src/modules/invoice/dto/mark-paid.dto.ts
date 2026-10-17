import { IsDateString, IsNumber, IsOptional, Min } from 'class-validator';

export class MarkPaidDto {
  @IsOptional() @IsNumber() @Min(0) paidAmount?: number;
  @IsOptional() @IsDateString() paidAt?: string;
}
