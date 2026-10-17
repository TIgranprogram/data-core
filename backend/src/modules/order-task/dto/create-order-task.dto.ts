import { IsArray, IsDateString, IsIn, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { IsObjectId } from '../../../common/decorators/is-object-id.decorator';
import { ToObjectId } from '../../../common/decorators/to-object-id.decorator';

export class CreateOrderTaskDto {
  @IsObjectId()
  @ToObjectId()
  productionOrderId!: string;

  @IsOptional() @IsObjectId() @ToObjectId() componentId?: string;
  @IsOptional() @IsString() componentName?: string;
  @IsOptional() @IsObjectId() @ToObjectId() workTypeId?: string;
  @IsOptional() @IsString() workTypeName?: string;
  @IsOptional() @IsObjectId() @ToObjectId() workerId?: string;
  @IsOptional() @IsObjectId() @ToObjectId() workCenterId?: string;

  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() notes?: string;

  @IsOptional()
  @IsIn(['pending', 'in_progress', 'completed', 'skipped', 'cancelled'])
  status?: 'pending' | 'in_progress' | 'completed' | 'skipped' | 'cancelled';

  @IsOptional() @IsNumber() @Min(0) estimatedHours?: number;
  @IsOptional() @IsNumber() actualHours?: number;
  @IsOptional() @IsNumber() sortOrder?: number;

  @IsOptional() @IsDateString() actualStartDate?: string;
  @IsOptional() @IsDateString() actualEndDate?: string;

  @IsOptional()
  @IsArray()
  @IsObjectId({ each: true })
  @ToObjectId()
  dependsOnTaskIds?: string[];
}
