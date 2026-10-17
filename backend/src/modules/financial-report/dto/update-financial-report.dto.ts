import { IsIn, IsOptional, IsString } from 'class-validator';

export class UpdateFinancialReportDto {
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional()
  @IsIn(['draft', 'generated', 'exported', 'archived'])
  status?: 'draft' | 'generated' | 'exported' | 'archived';
}
