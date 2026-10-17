import { IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { IsObjectId } from '../../../common/decorators/is-object-id.decorator';

export class CreateWorkOrderOperationDto {
  @IsObjectId()
  workOrderId!: string;

  @IsOptional() @IsObjectId() operationId?: string;
  @IsOptional() @IsObjectId() statusId?: string;
  @IsOptional() @IsObjectId() completedBy?: string;

  @IsOptional() @IsNumber() @Min(0) order?: number;
  @IsOptional() @IsNumber() @Min(0) plannedDuration?: number;
  @IsOptional() @IsNumber() @Min(0) actualDuration?: number;

  @IsOptional() @IsString() notes?: string;
}
