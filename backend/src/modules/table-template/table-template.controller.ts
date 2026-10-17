import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { TableTemplateService } from './table-template.service';
import { CreateTableTemplateDto } from './dto/create-table-template.dto';
import { UpdateTableTemplateDto } from './dto/update-table-template.dto';
import { AuditAction } from '../../common/decorators/audit-action.decorator';

/**
 * TZ-86 Phase A.2 — TableTemplateController extended.
 *
 * New route: `GET /api/table-templates/:id/preview` returns inline HTML
 * (text/html). Used by Phase C.2 picker preview pane + Phase D.3 canvas
 * placeholder. No `@AuditAction` decoration — GET routes auto-skip the
 * AuditInterceptor (it filters to POST/PATCH/PUT/DELETE).
 */
@Controller('table-templates')
export class TableTemplateController {
  constructor(private readonly service: TableTemplateService) {}

  @Get()
  findAll(
    @Query('activeOnly') activeOnly?: string,
    @Query('isActive') isActive?: string,
  ) {
    const onlyActive = activeOnly === 'true' || isActive === 'true';
    return this.service.findAll(onlyActive ? { activeOnly: true } : undefined);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findById(id);
  }

  /**
   * TZ-86 Phase A.2 — preview endpoint. Returns HTML string.
   * For preview-pane usage, client should fetch and inject via
   * `[innerHTML]` (after sanitisation on frontend side; service already
   * escapes user-data cells).
   */
  @Get(':id/preview')
  async preview(@Param('id') id: string): Promise<string> {
    return this.service.preview(id);
  }

  @Post()
  @Roles('admin', 'manager')
  @AuditAction({ action: 'create', entityType: 'TableTemplate' })
  create(@Body() dto: CreateTableTemplateDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'update', entityType: 'TableTemplate' })
  update(@Param('id') id: string, @Body() dto: UpdateTableTemplateDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'delete', entityType: 'TableTemplate' })
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
