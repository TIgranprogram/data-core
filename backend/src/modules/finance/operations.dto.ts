import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsMongoId, IsOptional, IsString, Length, Matches, Max, Min } from 'class-validator';
import { FINANCIAL_COST_CENTERS } from '../../common/financial-classification';
export class OperationsQueryDto {
  @ApiPropertyOptional() @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) from?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) to?: string;
  @ApiPropertyOptional() @IsOptional() @IsIn(['income', 'expense']) type?: 'income' | 'expense';
  @ApiPropertyOptional() @IsOptional() @IsMongoId() companyId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 200) org?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 30) articleId?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsIn([0, 1]) includeDescendants?: number;
  @ApiPropertyOptional() @IsOptional() @IsMongoId() salesOrderId?: string;
  @ApiPropertyOptional() @IsOptional() @IsIn(FINANCIAL_COST_CENTERS) costCenter?: string;
  @ApiPropertyOptional() @IsOptional() @IsMongoId() counterpartyId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 300) counterpartyName?: string;
  @ApiPropertyOptional() @IsOptional() @IsIn(['invoice', 'request', 'income', 'expense', 'payroll', 'supply']) source?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsIn([0, 1]) unassigned?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
  @ApiPropertyOptional() @IsOptional() @IsIn(['date', 'amount']) sort?: 'date' | 'amount';
  @ApiPropertyOptional() @IsOptional() @IsIn(['asc', 'desc']) dir?: 'asc' | 'desc';
}
export class ClassificationDto {
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsMongoId() articleId?: string | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsMongoId() salesOrderId?: string | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsIn(FINANCIAL_COST_CENTERS) costCenter?: string | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsString() @Length(0, 1000) costObject?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() resetToOriginal?: boolean;
  @ApiProperty() @IsString() @Length(3, 1000) reason!: string;
  @ApiProperty() @IsString() @Length(1, 100) clientUid!: string;
  @ApiProperty() @IsInt() @Min(0) version!: number;
}
