import { PartialType } from '@nestjs/swagger';
import { CreateProductModuleDto } from './create-product-module.dto';

export class UpdateProductModuleDto extends PartialType(CreateProductModuleDto) {}
