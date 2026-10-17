import { IsArray, IsDateString, IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { IsObjectId } from '../../../common/decorators/is-object-id.decorator';

export class CreateTenderDto {
  @IsString() @IsNotEmpty() number!: string;
  @IsOptional() @IsString() tenderId?: string;
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() subject?: string;
  @IsOptional() @IsString() productName?: string;
  @IsOptional() @IsNumber() @Min(0) quantity?: number;
  @IsOptional() @IsString() unit?: string;
  @IsOptional() @IsObjectId() companyId?: string;
  @IsOptional() @IsObjectId() customerOrgId?: string;
  @IsOptional() @IsString() customerName?: string;
  @IsOptional() @IsString() email?: string;
  @IsOptional() @IsString() deliveryTerms?: string;
  @IsOptional() @IsString() responseRequirements?: string;
  @IsOptional() @IsString() legalBasis?: string;
  @IsOptional() @IsString() noticeNumber?: string;
  @IsOptional() @IsString() platformUrl?: string;
  @IsOptional() @IsNumber() @Min(0) startPrice?: number;
  @IsOptional() @IsNumber() @Min(0) ourPrice?: number;
  @IsOptional() @IsNumber() @Min(0) totalAmount?: number;
  @IsOptional() @IsDateString() publishDate?: string;
  @IsOptional() @IsDateString() submissionDeadline?: string;
  @IsOptional() @IsDateString() resultDate?: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  attachments?: string[];
}
