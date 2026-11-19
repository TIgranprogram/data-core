import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { IsArray, ArrayMaxSize, IsBoolean, IsIn, IsInt, IsISO8601, IsMongoId, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';
export class FinancialArticleWriteDto {
  @ApiProperty() @IsInt() @Min(0) expectedTreeRevision!: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) version?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) name?: string;
  @ApiPropertyOptional({ enum: ['income', 'expense'] }) @IsOptional() @IsIn(['income', 'expense']) type?: 'income' | 'expense';
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsMongoId() parentId?: string | null;
  @ApiPropertyOptional({ enum: ['group', 'article'] }) @IsOptional() @IsIn(['group', 'article']) nodeKind?: 'group' | 'article';
  @ApiPropertyOptional() @IsOptional() @IsBoolean() selectable?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsNumber() sortOrder?: number;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsISO8601() archivedAt?: string | null;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(200) @IsMongoId({ each: true }) categoryIds?: string[];
}
export class FinancialArticleQueryDto {
  @ApiPropertyOptional({ enum: ['income', 'expense'] }) @IsOptional() @IsIn(['income', 'expense']) type?: 'income' | 'expense';
  @ApiPropertyOptional({ enum: ['0', '1'] }) @IsOptional() @IsIn(['0', '1']) includeArchived?: string;
  @ApiPropertyOptional({ enum: ['0', '1'] }) @IsOptional() @IsIn(['0', '1']) includeUsage?: string;
}
