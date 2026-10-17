import { PartialType } from '@nestjs/mapped-types';
import { CreateProductPassportDto } from './create-product-passport.dto';

export class UpdateProductPassportDto extends PartialType(CreateProductPassportDto) {}
