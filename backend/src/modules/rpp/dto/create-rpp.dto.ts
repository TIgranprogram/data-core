import { IsDateString, IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { IsObjectId } from '../../../common/decorators/is-object-id.decorator';

export class CreateRppDto {
  @IsString() @IsNotEmpty() number!: string;
  @IsOptional() @IsString() title?: string;
  @IsObjectId() productId!: string;
  @IsOptional() @IsString() productName?: string;
  @IsOptional() @IsString() productSku?: string;
  @IsOptional() @IsString() registryNumber?: string;
  @IsOptional() @IsIn(['draft', 'submitted', 'registered', 'active', 'expired', 'cancelled'])
  status?: 'draft' | 'submitted' | 'registered' | 'active' | 'expired' | 'cancelled';
  @IsOptional() @IsDateString() submissionDate?: string;
  @IsOptional() @IsDateString() registrationDate?: string;
  @IsOptional() @IsDateString() expiryDate?: string;
  @IsOptional() @IsString() notes?: string;
}
