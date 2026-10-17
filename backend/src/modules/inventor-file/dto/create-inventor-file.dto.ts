import { IsOptional, IsString } from 'class-validator';
import { IsObjectId } from '../../../common/decorators/is-object-id.decorator';

export class CreateInventorFileDto {
  @IsObjectId()
  productId!: string;

  @IsOptional() @IsString() productName?: string;
  @IsOptional() @IsString() productSku?: string;
  @IsOptional() @IsString() fileType?: string;
  @IsOptional() @IsString() author?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() version?: number;
}
