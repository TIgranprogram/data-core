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
import { Roles } from '../../common/decorators/roles.decorator';
import { AuditAction } from '../../common/decorators/audit-action.decorator';
import type { Request } from 'express';
import { TextBlockCategoryService } from './text-block-category.service';
import { CreateTextBlockCategoryDto } from './dto/create-text-block-category.dto';
import { UpdateTextBlockCategoryDto } from './dto/update-text-block-category.dto';

/**
 * TZ-DOC-315 — REST surface for text-block categories.
 *
 * RBAC mirrors DocumentTemplateCategoryController (TZ-DOC-307): admins +
 * managers may read, admin-only mutations (matches text-block CRUD policy).
 * Read endpoints are org-scoped by the authenticated user's
 * `organizationId`; system categories stay visible to every org.
 *
 * Mutations pass `req.user.organizationId` into the service so that
 * update/remove refuse categories owned by a DIFFERENT organization
 * (403 — IDOR guard).
 */
@ApiTags('Справочники — Категории текстов')
@Controller('text-block-categories')
export class TextBlockCategoryController {
  constructor(private readonly service: TextBlockCategoryService) {}

  @Get()
  @Roles('admin', 'director', 'manager')
  @ApiOperation({ summary: 'List text-block categories' })
  @ApiQuery({ name: 'activeOnly', required: false })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'parentId', required: false, description: 'Subcategories of this root' })
  @ApiQuery({ name: 'rootsOnly', required: false, description: 'Top-level categories only' })
  @ApiResponse({ status: 200, description: 'List of categories' })
  list(
    @Query('activeOnly') activeOnly?: string,
    @Query('search') search?: string,
    @Query('parentId') parentId?: string,
    @Query('rootsOnly') rootsOnly?: string,
    @Req() req?: Request & { user?: { organizationId?: string | null } },
  ) {
    return this.service.findAll({
      activeOnly: activeOnly === 'true',
      search,
      parentId,
      rootsOnly: rootsOnly === 'true',
      organizationId: req?.user?.organizationId ?? null,
    });
  }

  @Get(':id')
  @Roles('admin', 'director', 'manager')
  @ApiOperation({ summary: 'Get text-block category by ID' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 404 })
  findOne(@Param('id') id: string) {
    return this.service.findById(id);
  }

  @Post()
  @Roles('admin')
  @AuditAction({ action: 'create', entityType: 'TextBlockCategory' })
  @ApiOperation({ summary: 'Create a text-block category (admin only)' })
  @ApiResponse({ status: 201 })
  @ApiResponse({ status: 409, description: 'Duplicate slug in scope' })
  create(
    @Body() dto: CreateTextBlockCategoryDto,
    @Req() req?: Request & { user?: { organizationId?: string | null } },
  ) {
    return this.service.create(dto, req?.user?.organizationId ?? null);
  }

  @Patch(':id')
  @Roles('admin')
  @AuditAction({ action: 'update', entityType: 'TextBlockCategory', idParam: 'id' })
  @ApiOperation({ summary: 'Update / rename a category (admin only)' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 403 })
  @ApiResponse({ status: 409 })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateTextBlockCategoryDto,
    @Req() req?: Request & { user?: { organizationId?: string | null } },
  ) {
    return this.service.update(id, dto, req?.user?.organizationId ?? null);
  }

  @Delete(':id')
  @Roles('admin')
  @AuditAction({ action: 'delete', entityType: 'TextBlockCategory', idParam: 'id' })
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a category (admin only; 409 when in use)' })
  @ApiResponse({ status: 204 })
  @ApiResponse({ status: 403 })
  @ApiResponse({ status: 409, description: 'In use or system category' })
  remove(
    @Param('id') id: string,
    @Req() req?: Request & { user?: { organizationId?: string | null } },
  ) {
    return this.service.remove(id, req?.user?.organizationId ?? null);
  }
}
