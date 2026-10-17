import { IsDateString, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { IsObjectId } from '../../../common/decorators/is-object-id.decorator';
import { ToObjectId } from '../../../common/decorators/to-object-id.decorator';

export class CreateProductionOrderDto {
  /**
   * Keep the public HTTP contract as a string so `IsObjectId` validates the
   * original 24-hex value. The production service converts it at its
   * persistence boundary; transforming this field before validation made a
   * valid productId fail with 400 (TZ-BACKEND-E2E-HARNESS).
   */
  @IsObjectId()
  productId!: string;

  @IsNumber()
  @Min(1)
  quantity!: number;

  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() ralCode?: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsString() packageTag?: string;

  @IsOptional() @IsDateString() plannedStartDate?: string;
  @IsOptional() @IsDateString() plannedEndDate?: string;

  @IsOptional() @IsObjectId() @ToObjectId() workCenterId?: string;
  @IsOptional() @IsObjectId() @ToObjectId() workTypeId?: string;
  @IsOptional() @IsObjectId() @ToObjectId() contractId?: string;
  @IsOptional() @IsObjectId() @ToObjectId() proposalId?: string;
}
