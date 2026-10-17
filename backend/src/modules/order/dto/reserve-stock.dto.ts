import { IsObjectId } from '../../../common/decorators/is-object-id.decorator';
import { IsOptional, IsString } from 'class-validator';

export class ReserveStockDto {
  @IsObjectId()
  warehouseId!: string;

  @IsOptional() @IsString() zoneName?: string;
}
