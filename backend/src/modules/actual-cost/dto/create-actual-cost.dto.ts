import { IsDateString, IsIn, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { IsObjectId } from '../../../common/decorators/is-object-id.decorator';

export class CreateActualCostDto {
  /**
   * Optional in the request body — the ActualCostController merges
   * `orderId` from the URL param (`production-orders/:orderId/actual-costs`).
   * Marked @IsOptional() so the ValidationPipe doesn't reject the body
   * before the controller has a chance to inject it.
   */
  @IsOptional() @IsObjectId() orderId?: string;

  @IsIn(['material', 'labor', 'overhead', 'other'])
  type!: 'material' | 'labor' | 'overhead' | 'other';

  @IsNumber()
  @Min(0)
  amount!: number;

  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() sourceRef?: string;
  @IsOptional() @IsDateString() date?: string;
  @IsOptional() @IsObjectId() createdBy?: string;
}
