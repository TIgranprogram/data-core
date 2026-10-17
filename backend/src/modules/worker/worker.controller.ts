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
  Req,
} from '@nestjs/common';
import {
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuditAction } from '../../common/decorators/audit-action.decorator';
import { WorkerService } from './worker.service';
import { CreateWorkerDto } from './dto/create-worker.dto';
import { UpdateWorkerDto } from './dto/update-worker.dto';
import { FindWorkersDto } from './dto/find-workers.dto';

/**
 * TZ-WORKERS-301 — REST surface for the unified People entity (Worker).
 *
 * RBAC: read — admin/manager/user; mutations — admin/manager (как
 * counterparty). organizationId ВСЕГДА берётся из req.user (IDOR guard),
 * НИКОГДА из тела/query. Mutations фиксируются AuditAction.
 */
@ApiTags('Справочники — Люди (Worker)')
@Controller('workers')
export class WorkerController {
  constructor(private readonly service: WorkerService) {}

  private orgOf(req: Request): string | null | undefined {
    return (req.user as { organizationId?: string | null } | undefined)
      ?.organizationId;
  }

  @Get()
  @Roles('admin', 'director', 'manager', 'user')
  @ApiOperation({ summary: 'List workers (org-scoped, envelope)' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'search', required: false, type: String })
  @ApiQuery({ name: 'isActive', required: false, type: Boolean })
  @ApiQuery({ name: 'supplierId', required: false, type: String })
  @ApiQuery({ name: 'workTypeId', required: false, type: String })
  @ApiResponse({ status: 200, description: 'Envelope { items, total, page, limit }' })
  findAll(@Query() query: FindWorkersDto, @Req() req: Request) {
    return this.service.findAll(query, this.orgOf(req));
  }

  @Get(':id')
  @Roles('admin', 'director', 'manager', 'user')
  @ApiOperation({ summary: 'Get worker by ID (org-scoped read)' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 403, description: 'Foreign org scope' })
  @ApiResponse({ status: 404 })
  findOne(@Param('id') id: string, @Req() req: Request) {
    return this.service.findById(id, this.orgOf(req));
  }

  @Post()
  @Roles('admin', 'manager')
  @AuditAction({ action: 'create', entityType: 'Worker' })
  @ApiOperation({ summary: 'Create a worker/people entry (manager+)' })
  @ApiResponse({ status: 201 })
  @ApiResponse({ status: 400, description: 'Validation / not a supplier org' })
  @ApiResponse({ status: 404, description: 'Broken FK reference' })
  @ApiResponse({ status: 409, description: 'Duplicate email in org scope' })
  create(@Body() dto: CreateWorkerDto, @Req() req: Request) {
    return this.service.create(dto, this.orgOf(req));
  }

  @Patch(':id')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'update', entityType: 'Worker', idParam: 'id' })
  @ApiOperation({ summary: 'Update a worker (manager+)' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 403, description: 'Foreign org scope' })
  @ApiResponse({ status: 404 })
  @ApiResponse({ status: 409, description: 'Duplicate email in org scope' })
  update(@Param('id') id: string, @Body() dto: UpdateWorkerDto, @Req() req: Request) {
    return this.service.update(id, dto, this.orgOf(req));
  }

  @Delete(':id')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'delete', entityType: 'Worker', idParam: 'id' })
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft-delete a worker (manager+)' })
  @ApiResponse({ status: 204 })
  @ApiResponse({ status: 403 })
  @ApiResponse({ status: 404 })
  remove(@Param('id') id: string, @Req() req: Request) {
    return this.service.remove(id, this.orgOf(req));
  }
}
