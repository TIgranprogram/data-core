import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { DocumentTableTypeService } from './document-table-type.service';
import { CreateDocumentTableTypeDto } from './dto/create-document-table-type.dto';
import { UpdateDocumentTableTypeDto } from './dto/update-document-table-type.dto';
import { AuditAction } from '../../common/decorators/audit-action.decorator';

@Controller('document-table-types')
export class DocumentTableTypeController {
  constructor(private readonly service: DocumentTableTypeService) {}

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findById(id);
  }

  @Post()
  @Roles('admin', 'manager')
  @AuditAction({ action: 'create', entityType: 'DocumentTableType' })
  create(@Body() dto: CreateDocumentTableTypeDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'update', entityType: 'DocumentTableType' })
  update(@Param('id') id: string, @Body() dto: UpdateDocumentTableTypeDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'delete', entityType: 'DocumentTableType' })
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
