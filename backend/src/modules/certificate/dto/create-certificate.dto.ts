import {
  IsArray,
  IsDateString,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';
import { IsObjectId } from '../../../common/decorators/is-object-id.decorator';

export class CreateCertificateDto {
  @IsOptional()
  @IsArray()
  @IsObjectId({ each: true })
  productIds?: string[];

  @IsString()
  @IsNotEmpty()
  number!: string;

  @IsIn(['declaration', 'certificate', 'iso', 'other'])
  certType!: 'declaration' | 'certificate' | 'iso' | 'other';

  @IsOptional()
  @IsIn(['active', 'expired', 'suspended', 'revoked'])
  status?: 'active' | 'expired' | 'suspended' | 'revoked';

  @IsString()
  @IsNotEmpty()
  issuedBy!: string;

  @IsDateString()
  issueDate!: string;

  @IsDateString()
  expiresAt!: string;

  @IsOptional()
  @IsString()
  fileUrl?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
