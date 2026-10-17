import { IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { IsObjectId } from '../../../common/decorators/is-object-id.decorator';

export class CreateCartItemDto {
  @IsString() @IsNotEmpty()
  sessionId!: string;

  @IsObjectId()
  productId!: string;

  @IsNumber() @Min(1)
  quantity!: number;

  @IsOptional() @IsString() unit?: string;
  @IsOptional() @IsNumber() @Min(0) markupPercent?: number;
  @IsOptional() @IsString() notes?: string;
}
