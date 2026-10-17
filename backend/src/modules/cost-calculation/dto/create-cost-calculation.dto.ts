import { IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';
import { IsObjectId } from '../../../common/decorators/is-object-id.decorator';

export class CreateCostCalculationDto {
  @IsOptional() @IsObjectId() productId?: string;

  @IsOptional() @IsObjectId() bomId?: string;
  @IsOptional() @IsString() bomVersion?: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsNumber() @Min(0) @Max(100) overheadPercent?: number;
}

