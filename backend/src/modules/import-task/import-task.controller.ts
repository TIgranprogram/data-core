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
  CreateImportTaskDto,
  PatchImportTaskProposalsDto,
  PatchImportTaskReportDto,
  PatchImportTaskRowsDto,
  PatchImportTaskStatusDto,
} from './dto/create-import-task.dto';
import { ImportTaskService } from './import-task.service';

/**
 * TZD-22 — Import Task API.
 * RBAC: same as mutation-journal propose path (admin | manager).
 * Does NOT create Material or journal proposals.
 */
@ApiTags('Import tasks (AI assembly point)')
@Controller('import-tasks')
export class ImportTaskController {
  constructor(private readonly service: ImportTaskService) {}

  @Post()
  @Roles('admin', 'manager')
  @AuditAction({ action: 'create', entityType: 'ImportTask' })
  @ApiOperation({
    summary: 'Create import task (ready_for_ai) — no journal proposals',
  })
  create(
    @Body() dto: CreateImportTaskDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.create(dto, user);
  }

  @Get()
  @Roles('admin', 'manager')
  @ApiOperation({
    summary: 'List import tasks (summary + rowCount, without full rows)',
  })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('status') status?: string,
    @Query('page') page = '1',
    @Query('limit') limit = '20',
  ) {
    return this.service.list(user, {
      status,
      page: parseInt(page, 10) || 1,
      limit: parseInt(limit, 10) || 20,
    });
  }

  @Get(':id')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Get import task with full rows' })
  getOne(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.getById(id, user);
  }

  @Patch(':id/status')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'update', entityType: 'ImportTask', idParam: 'id' })
  @ApiOperation({ summary: 'Patch import task status (whitelist transitions)' })
  patchStatus(
    @Param('id') id: string,
    @Body() dto: PatchImportTaskStatusDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.patchStatus(id, dto, user);
  }

  @Patch(':id/report')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'update', entityType: 'ImportTask', idParam: 'id' })
  @ApiOperation({
    summary: 'TZD-23 — write AI matching report + move to analyzing/awaiting_user',
  })
  patchReport(
    @Param('id') id: string,
    @Body() dto: PatchImportTaskReportDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.patchReport(id, dto, user);
  }

  @Patch(':id/proposals')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'update', entityType: 'ImportTask', idParam: 'id' })
  @ApiOperation({
    summary: 'TZD-23 — link proposal ids + move to applying/done/failed',
  })
  patchProposals(
    @Param('id') id: string,
    @Body() dto: PatchImportTaskProposalsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.patchProposals(id, dto, user);
  }

  @Patch(':id/rows')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'update', entityType: 'ImportTask', idParam: 'id' })
  @ApiOperation({
    summary: 'TZD-26 — safe AI reshape: replace rows (+columnMap/reshapeNote), resets aiReport',
  })
  patchRows(
    @Param('id') id: string,
    @Body() dto: PatchImportTaskRowsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.patchRows(id, dto, user);
  }

  @Post(':id/cancel')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Soft-cancel → status cancelled' })
  cancel(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.cancel(id, user);
  }
}
