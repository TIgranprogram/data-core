import { PartialType } from '@nestjs/swagger';
import { CreateTextBlockCategoryDto } from './create-text-block-category.dto';

/** TZ-DOC-315 — all fields optional; rename keeps the id stable. */
export class UpdateTextBlockCategoryDto extends PartialType(
  CreateTextBlockCategoryDto,
) {}
