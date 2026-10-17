import { PartialType } from '@nestjs/swagger';
import { CreateDocumentTemplateCategoryDto } from './create-document-template-category.dto';

/** TZ-DOC-307 — all fields optional; rename keeps the id stable. */
export class UpdateDocumentTemplateCategoryDto extends PartialType(
  CreateDocumentTemplateCategoryDto,
) {}
