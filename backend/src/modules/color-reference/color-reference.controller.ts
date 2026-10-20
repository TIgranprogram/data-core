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
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { AuditAction } from '../../common/interceptors/audit.interceptor';
import { Roles } from '../../common/decorators/roles.decorator';
import type { Request } from 'express';
import { ColorReferenceService } from './color-reference.service';
import { CreateColorReferenceDto } from './dto/create-color-reference.dto';
import { UpdateColorReferenceDto } from './dto/update-color-reference.dto';

/**
 * TZ-PRODUCTS-301 — REST surface for the color reference dictionary.
 *
 * RBAC mirrors the TZ-DOC-307/315 controllers: admins + managers may mutate;
 * reads are available to users too (the RAL dropdown in the product form is
 * used by any authenticated user). Read endpoints are org-scoped by the
 * authenticated user's `organizationId` (system colors stay visible to every
 * org).
 *
 * Mutations pass `req.user.organizationId` into the service so update/remove
 * refuse colors owned by a DIFFERENT organization (403 — IDOR guard).
 */
@ApiTags('Справочники — Цвета')
@Controller('color-references')
export class ColorReferenceController {
  constructor(private readonly service: ColorReferenceService) {}

  @Get()
  @Roles('user', 'admin', 'director', 'manager')
  @ApiOperation({ summary: 'List color references' })
  @ApiQuery({ name: 'activeOnly', required: false, description: 'Only active colors' })
  @ApiQuery({ name: 'search', required: false, description: 'Search by name or slug' })
  @ApiResponse({ status: 200, description: 'List of colors' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  list(
    @Query('activeOnly') activeOnly?: string,
    @Query('search') search?: string,
    @Req() req?: Request & { user?: { organizationId?: string | null } },
  ) {
    return this.service.findAll({
      activeOnly: activeOnly === 'true',
      search,
      organizationId: req?.user?.organizationId ?? null,
    });
  }

  @Get(':id')
  @Roles('user', 'admin', 'director', 'manager')
  @ApiOperation({ summary: 'Get color reference by ID' })
  @ApiResponse({ status: 200, description: 'Color found' })
  @ApiResponse({ status: 404, description: 'Color not found' })
  findOne(@Param('id') id: string) {
    return this.service.findById(id);
  }

  @Post()
  @Roles('admin', 'manager')
  @AuditAction({ action: 'create', entityType: 'ColorReference' })
  @ApiOperation({ summary: 'Create a color reference (admin/manager)' })
  @ApiResponse({ status: 201, description: 'Color created' })
  @ApiResponse({ status: 400, description: 'Invalid hex' })
  @ApiResponse({ status: 409, description: 'Duplicate slug in scope' })
  create(
    @Body() dto: CreateColorReferenceDto,
    @Req() req?: Request & { user?: { organizationId?: string | null } },
  ) {
    return this.service.create(dto, req?.user?.organizationId ?? null);
  }

  @Patch(':id')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'update', entityType: 'ColorReference', idParam: 'id' })
  @ApiOperation({ summary: 'Update / rename a color (admin/manager)' })
  @ApiResponse({ status: 200, description: 'Color updated' })
  @ApiResponse({ status: 403, description: 'Color belongs to another organization' })
  @ApiResponse({ status: 409, description: 'Duplicate slug in scope / system color' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateColorReferenceDto,
    @Req() req?: Request & { user?: { organizationId?: string | null } },
  ) {
    return this.service.update(id, dto, req?.user?.organizationId ?? null);
  }

  @Delete(':id')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'delete', entityType: 'ColorReference', idParam: 'id' })
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a color (admin/manager; 409 for system/default)' })
  @ApiResponse({ status: 204, description: 'Color deleted' })
  @ApiResponse({ status: 403, description: 'Color belongs to another organization' })
  @ApiResponse({ status: 409, description: 'System / default color' })
  remove(
    @Param('id') id: string,
    @Req() req?: Request & { user?: { organizationId?: string | null } },
  ) {
    return this.service.remove(id, req?.user?.organizationId ?? null);
  }
}
