import { IsDateString, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { IsObjectId } from '../../../common/decorators/is-object-id.decorator';

export class CreateWorkOrderDto {
  @IsObjectId()
  orderId!: string;

  @IsObjectId()
  productId!: string;

  @IsNumber()
  @Min(1)
  qty!: number;

  @IsOptional() @IsObjectId() statusId?: string;
  @IsOptional() @IsObjectId() assignedTo?: string;
  @IsOptional() @IsDateString() startDate?: string;
  @IsOptional() @IsDateString() endDate?: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsObjectId() orderTaskId?: string;
  @IsOptional() @IsObjectId() workTypeId?: string;
}
