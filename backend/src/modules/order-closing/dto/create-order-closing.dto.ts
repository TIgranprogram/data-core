import { IsDateString, IsIn, IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { IsObjectId } from '../../../common/decorators/is-object-id.decorator';

export class CreateOrderClosingDto {
  @IsObjectId()
  productionOrderId!: string;

  @IsIn(['final', 'partial', 'corrective'])
  closingType!: 'final' | 'partial' | 'corrective';

  @IsString()
  @IsNotEmpty()
  number!: string;

  @IsDateString()
  date!: string;

  @IsOptional() @IsNumber() @Min(0) amount?: number;
  @IsOptional() @IsNumber() @Min(0) totalAmount?: number;
  @IsOptional() @IsObjectId() organizationId?: string;
  @IsOptional() @IsString() fileUrl?: string;
  @IsOptional() @IsString() notes?: string;
}
