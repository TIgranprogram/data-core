import { PartialType } from '@nestjs/swagger';
import { CreateColorReferenceDto } from './create-color-reference.dto';

/** TZ-PRODUCTS-301 — all fields optional; rename keeps the id stable. */
export class UpdateColorReferenceDto extends PartialType(CreateColorReferenceDto) {}
