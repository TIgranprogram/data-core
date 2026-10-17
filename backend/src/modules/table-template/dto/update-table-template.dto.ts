import { PartialType } from '@nestjs/mapped-types';
import { CreateTableTemplateDto } from './create-table-template.dto';

/**
 * TZ-86 Phase A.2 — UpdateTableTemplateDto.
 *
 * PartialType(CreateTableTemplateDto) автоматически делает new A.2 fields
 * (`category`, `sortOrder`, `sampleRows`, `dataSource`) optional.
 * Additive-merge semantics: PATCH /api/table-templates/:id only writes
 * fields present in body; absent fields retained.
 *
 * Минимальных изменений достаточно — фронт не нуждается в UpdateDto-rework.
 */
export class UpdateTableTemplateDto extends PartialType(CreateTableTemplateDto) {}
