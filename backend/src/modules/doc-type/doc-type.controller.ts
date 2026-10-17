import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { DocTypeService } from './doc-type.service';
import { CreateDocTypeDto } from './dto/create-doc-type.dto';
import { UpdateDocTypeDto } from './dto/update-doc-type.dto';
import { AuditAction } from '../../common/decorators/audit-action.decorator';

@Controller('doc-types')
export class DocTypeController {
  constructor(private readonly service: DocTypeService) {}

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Get('by-slug/:slug')
  findBySlug(@Param('slug') slug: string) {
    return this.service.findBySlug(slug);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findById(id);
  }

  @Post()
  @Roles('admin', 'manager')
  @AuditAction({ action: 'create', entityType: 'DocType' })
  create(@Body() dto: CreateDocTypeDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'update', entityType: 'DocType' })
  update(@Param('id') id: string, @Body() dto: UpdateDocTypeDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'delete', entityType: 'DocType' })
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
