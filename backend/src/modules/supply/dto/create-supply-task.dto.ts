import { Type } from 'class-transformer';
import { IsNumber, IsOptional, IsString, Length, Min } from 'class-validator';
import { IsObjectId } from '../../../common/decorators/is-object-id.decorator';

export class ExplodeSupplyTasksDto {
  @IsObjectId()
  orderId!: string;

  @IsOptional()
  @IsObjectId()
  moduleId?: string;
}

export class CreateSupplyTaskDto {
  @IsObjectId()
  orderId!: string;

  @IsOptional()
  @IsString()
  @Length(1, 64)
  orderLineId?: string;

  @IsOptional()
  @IsObjectId()
  materialId?: string;

  @IsOptional()
  @IsObjectId()
  moduleId?: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  qty!: number;

  @IsOptional()
  @IsString()
  @Length(0, 2000)
  notes?: string;

  @IsOptional()
  @IsString()
  @Length(1, 256)
  title?: string;
}

export class UpdateSupplyTaskDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  qty?: number;

  @IsOptional()
  @IsString()
  @Length(0, 2000)
  notes?: string;

  @IsOptional()
  @IsString()
  @Length(1, 256)
  title?: string;
}
