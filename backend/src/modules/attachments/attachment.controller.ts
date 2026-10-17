import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { AuditAction } from '../../common/decorators/audit-action.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AttachmentService } from './attachment.service';
import { CreateAttachmentDto, UpdateAttachmentDto } from './attachment.dto';
import { ListAttachmentsQueryDto } from './attachment.query.dto';

@Controller('catalog-attachments')
export class AttachmentController {
  constructor(private readonly service: AttachmentService) {}

  @Get()
  @Roles('admin', 'manager', 'user')
  list(@Query() query: ListAttachmentsQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.service.list(query.entityType, query.entityId, user);
  }

  @Post()
  @Roles('admin', 'manager')
  @AuditAction({ action: 'create', entityType: 'CatalogAttachment' })
  create(@Body() dto: CreateAttachmentDto, @CurrentUser() user: AuthenticatedUser) {
    return this.service.create(dto, user);
  }

  @Patch(':id')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'update', entityType: 'CatalogAttachment', idParam: 'id' })
  update(@Param('id') id: string, @Body() dto: UpdateAttachmentDto, @CurrentUser() user: AuthenticatedUser) {
    return this.service.update(id, dto, user);
  }

  @Delete(':id')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'delete', entityType: 'CatalogAttachment', idParam: 'id' })
  remove(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.remove(id, user);
  }
}
