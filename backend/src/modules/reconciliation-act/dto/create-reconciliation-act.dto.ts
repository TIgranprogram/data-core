import { IsDateString, IsOptional, IsString } from 'class-validator';
import { IsObjectId } from '../../../common/decorators/is-object-id.decorator';

export class CreateReconciliationActDto {  @IsObjectId() organizationId!: string;

  @IsOptional() @IsString() organizationName?: string;

  @IsOptional() @IsString() number?: string;

  @IsDateString()
  periodStart!: string;

  @IsDateString()
  periodEnd!: string;

  @IsOptional() @IsString() notes?: string;
}
