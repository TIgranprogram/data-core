import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { IsObjectId } from '../../../common/decorators/is-object-id.decorator';

export class CreateProductPassportDto {
  @IsObjectId()
  productId!: string;

  @IsString()
  @IsNotEmpty()
  passportNumber!: string;

  @IsOptional() @IsString() productCode?: string;
  @IsOptional() @IsString() warrantyCode?: string;
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsString() article?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() installationSite?: string;
  @IsOptional() @IsString() supplier?: string;
  @IsOptional() @IsString() photo?: string;
  @IsOptional() height?: number;
  @IsOptional() length?: number;
  @IsOptional() width?: number;
  @IsOptional() weight?: number;
  @IsOptional() date?: Date;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
