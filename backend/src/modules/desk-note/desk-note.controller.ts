import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuditAction } from '../../common/interceptors/audit.interceptor';
import {
  CreateDeskNoteDto,
  UpdateDeskNoteDto,
} from './dto/desk-note.dto';
import { DeskNoteService } from './desk-note.service';

@Controller('desk-notes')
export class DeskNoteController {
  constructor(private readonly service: DeskNoteService) {}

  @Get()
  @Roles('admin', 'director', 'manager', 'user')
  list(
    @Query('orderId') orderId?: string,
    @Query('lineId') lineId?: string,
    @Query('moduleId') moduleId?: string,
  ) {
    return this.service.findAll({ orderId, lineId, moduleId });
  }

  @Post()
  @Roles('admin', 'director', 'manager', 'user')
  @AuditAction({ action: 'create', entityType: 'DeskNote' })
  create(
    @Body() dto: CreateDeskNoteDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.create(dto, user.id);
  }

  @Patch(':id')
  @Roles('admin', 'director', 'manager', 'user')
  @AuditAction({ action: 'update', entityType: 'DeskNote', idParam: 'id' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateDeskNoteDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.update(id, dto, { id: user.id, role: user.role });
  }

  @Delete(':id')
  @Roles('admin', 'director', 'manager', 'user')
  @AuditAction({ action: 'delete', entityType: 'DeskNote', idParam: 'id' })
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.remove(id, { id: user.id, role: user.role });
  }
}
