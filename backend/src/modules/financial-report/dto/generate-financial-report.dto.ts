import { IsDateString, IsIn, IsOptional, IsString } from 'class-validator';

export class GenerateFinancialReportDto {
  @IsIn(['monthly', 'quarterly', 'yearly', 'custom'])
  reportType!: 'monthly' | 'quarterly' | 'yearly' | 'custom';

  @IsDateString()
  periodStart!: string;

  @IsDateString()
  periodEnd!: string;

  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() notes?: string;
}
