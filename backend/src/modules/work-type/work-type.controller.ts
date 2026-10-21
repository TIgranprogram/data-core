import { Body, Controller, Get, Delete, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { WorkTypeService } from './work-type.service';
import { CreateWorkTypeDto } from './dto/create-work-type.dto';
import { UpdateWorkTypeDto } from './dto/update-work-type.dto';
import { AuditAction } from '../../common/decorators/audit-action.decorator';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { CatalogGraphService } from '../catalog-graph/catalog-graph.service';

@ApiTags('Справочники — Виды работ')
@Controller('work-types')
export class WorkTypeController {
  constructor(private readonly service: WorkTypeService, private readonly catalogGraph: CatalogGraphService) {}

  @Get()
  @Roles('admin', 'director', 'manager')
  findAll(@Query('workCenterId') workCenterId?: string) { return this.service.findAll(workCenterId); }

  @Get(':id/where-used')
  @Roles('admin', 'director', 'manager', 'user')
  @ApiOperation({ summary: 'List modules that use this work type' })
  @ApiQuery({ name: 'page', required: false, description: 'Page number' })
  @ApiQuery({ name: 'limit', required: false, description: 'Page size, max 100' })
  @ApiResponse({ status: 200, description: 'Paginated work-type backlinks' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  getWhereUsed(@Param('id') id: string, @Query('page') page = '1', @Query('limit') limit = '20', @CurrentUser() user: AuthenticatedUser) { return this.catalogGraph.getWhereUsed('workType', id, { page: parseInt(page, 10), limit: parseInt(limit, 10), organizationId: user.organizationId }); }

  @Get(':id')
  @Roles('admin', 'director', 'manager', 'user')
  findOne(@Param('id') id: string) { return this.service.findById(id); }

  /** TZ-PRODUCTION-309: mutate requires production:write (not Roles ∧ Permissions). Admin * passes. */
  @Post()
  @Permissions('production:write')
  @AuditAction({ action: 'create', entityType: 'WorkType' })
  create(@Body() dto: CreateWorkTypeDto) { return this.service.create(dto); }

  @Patch(':id')
  @Permissions('production:write')
  @AuditAction({ action: 'update', entityType: 'WorkType', idParam: 'id' })
  update(@Param('id') id: string, @Body() dto: UpdateWorkTypeDto) { return this.service.update(id, dto); }

  @Delete(':id')
  @Permissions('production:write')
  @AuditAction({ action: 'archive', entityType: 'WorkType', idParam: 'id' })
  @ApiOperation({ summary: 'Archive a work type without hard delete' })
  @ApiResponse({ status: 409, description: 'Work type is referenced by history' })
  remove(@Param('id') id: string) { return this.service.remove(id); }
}
