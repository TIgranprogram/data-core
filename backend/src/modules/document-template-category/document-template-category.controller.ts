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
import { DocumentTemplateCategoryService } from './document-template-category.service';
import { CreateDocumentTemplateCategoryDto } from './dto/create-document-template-category.dto';
import { UpdateDocumentTemplateCategoryDto } from './dto/update-document-template-category.dto';

/**
 * TZ-DOC-307 — REST surface for document-template categories.
 *
 * RBAC mirrors the generic CategoryController: admins + managers may read
 * (list/detail — needed by the template create form), admin-only mutations.
 * Read endpoints are org-scoped by the authenticated user's
 * `organizationId` (system categories stay visible to every org).
 *
 * Mutations pass `req.user.organizationId` into the service so update/remove
 * refuse categories owned by a DIFFERENT organization (403 — IDOR guard).
 */
@ApiTags('Справочники — Категории шаблонов')
@Controller('document-template-categories')
export class DocumentTemplateCategoryController {
  constructor(private readonly service: DocumentTemplateCategoryService) {}

  @Get()
  @Roles('admin', 'director', 'manager')
  @ApiOperation({ summary: 'List document-template categories' })
  @ApiQuery({ name: 'activeOnly', required: false, description: 'Only active categories' })
  @ApiQuery({ name: 'search', required: false, description: 'Search by name' })
  @ApiResponse({ status: 200, description: 'List of categories' })
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
  @Roles('admin', 'director', 'manager')
  @ApiOperation({ summary: 'Get document-template category by ID' })
  @ApiResponse({ status: 200, description: 'Category found' })
  @ApiResponse({ status: 404, description: 'Category not found' })
  findOne(@Param('id') id: string) {
    return this.service.findById(id);
  }

  @Post()
  @Roles('admin')
  @AuditAction({ action: 'create', entityType: 'DocumentTemplateCategory' })
  @ApiOperation({ summary: 'Create a document-template category (admin only)' })
  @ApiResponse({ status: 201, description: 'Category created' })
  @ApiResponse({ status: 409, description: 'Duplicate slug in scope' })
  create(
    @Body() dto: CreateDocumentTemplateCategoryDto,
    @Req() req?: Request & { user?: { organizationId?: string | null } },
  ) {
    return this.service.create(dto, req?.user?.organizationId ?? null);
  }

  @Patch(':id')
  @Roles('admin')
  @AuditAction({ action: 'update', entityType: 'DocumentTemplateCategory', idParam: 'id' })
  @ApiOperation({ summary: 'Update / rename a category (admin only)' })
  @ApiResponse({ status: 200, description: 'Category updated' })
  @ApiResponse({ status: 403, description: 'Category belongs to another organization' })
  @ApiResponse({ status: 409, description: 'Duplicate slug in scope / system category' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateDocumentTemplateCategoryDto,
    @Req() req?: Request & { user?: { organizationId?: string | null } },
  ) {
    return this.service.update(id, dto, req?.user?.organizationId ?? null);
  }

  @Delete(':id')
  @Roles('admin')
  @AuditAction({ action: 'delete', entityType: 'DocumentTemplateCategory', idParam: 'id' })
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a category (admin only; 409 when in use)' })
  @ApiResponse({ status: 204, description: 'Category deleted' })
  @ApiResponse({ status: 403, description: 'Category belongs to another organization' })
  @ApiResponse({ status: 409, description: 'Category is referenced by templates / system' })
  remove(
    @Param('id') id: string,
    @Req() req?: Request & { user?: { organizationId?: string | null } },
  ) {
    return this.service.remove(id, req?.user?.organizationId ?? null);
  }
}
