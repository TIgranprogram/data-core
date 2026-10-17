import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { AuditAction } from '../../common/interceptors/audit.interceptor';
import {
  CreateImportTodoDto,
  PatchImportTodoDto,
} from './dto/create-import-todo.dto';
import { ImportTodoService } from './import-todo.service';

/**
 * TZD-29 — manager import todos («что доделать после импорта»).
 * Org/RBAC как import-tasks (admin | manager).
 */
@ApiTags('Import todos (manager finish list)')
@Controller('import-todos')
export class ImportTodoController {
  constructor(private readonly service: ImportTodoService) {}

  @Post()
  @Roles('admin', 'manager')
  @AuditAction({ action: 'create', entityType: 'ImportTodo' })
  @ApiOperation({ summary: 'Create an import todo for the manager (TZD-29)' })
  create(
    @Body() dto: CreateImportTodoDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.create(dto, user);
  }

  @Get()
  @Roles('admin', 'director', 'manager')
  @ApiOperation({ summary: 'List import todos (filter by status)' })
  @ApiQuery({ name: 'status', required: false, enum: ['open', 'done'] })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('status') status?: string,
    @Query('page') page = '1',
    @Query('limit') limit = '50',
  ) {
    return this.service.list(user, {
      status,
      page: parseInt(page, 10) || 1,
      limit: parseInt(limit, 10) || 50,
    });
  }

  @Patch(':id')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'update', entityType: 'ImportTodo', idParam: 'id' })
  @ApiOperation({ summary: 'Patch todo status (open|done)' })
  patchStatus(
    @Param('id') id: string,
    @Body() dto: PatchImportTodoDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.patchStatus(id, dto, user);
  }
}
