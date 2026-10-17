import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AuditAction } from '../../common/interceptors/audit.interceptor';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { CreateCompositionLineDto, UpdateCompositionLineDto } from '../catalog/composition-line.dto';
import { CatalogGraphService, MAX_DEPTH } from '../catalog-graph/catalog-graph.service';
import { ProductModuleService, UpsertProductModuleDto } from './product-module.service';
import { CreateProductModuleDto } from './dto/create-product-module.dto';
import { UpdateProductModuleDto } from './dto/update-product-module.dto';

@ApiTags('Справочники — Модули')
@Controller('modules')
export class ProductModuleController {
  constructor(private readonly service: ProductModuleService, private readonly catalogGraph: CatalogGraphService) {}

  @Get()
  @Roles('admin', 'director', 'manager')
  list(@Query('productId') productId?: string) { return this.service.findAll(productId); }

  @Get('bulk')
  @Roles('admin', 'director', 'manager', 'user')
  @ApiOperation({ summary: 'Get multiple modules by IDs' })
  @ApiQuery({ name: 'ids', required: true, description: 'Comma-separated list of module IDs' })
  async findByIds(@Query('ids') ids: string) {
    if (!ids) return [];
    const idArray = ids.split(',').filter(Boolean);
    if (idArray.length === 0) return [];
    return this.service.findByIds(idArray);
  }

  @Get(':id/where-used')
  @Roles('admin', 'director', 'manager', 'user')
  @ApiOperation({ summary: 'List catalog parents that use this module' })
  @ApiQuery({ name: 'page', required: false, description: 'Page number' })
  @ApiQuery({ name: 'limit', required: false, description: 'Page size, max 100' })
  @ApiResponse({ status: 200, description: 'Paginated module backlinks' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  getWhereUsed(@Param('id') id: string, @Query('page') page = '1', @Query('limit') limit = '20', @CurrentUser() user: AuthenticatedUser) { return this.catalogGraph.getWhereUsed('module', id, { page: parseInt(page, 10), limit: parseInt(limit, 10), organizationId: user.organizationId }); }

  @Get(':id/composition')
  @Roles('admin', 'director', 'manager', 'user')
  getComposition(@Param('id') id: string) { return this.service.getComposition(id); }

  @Post(':id/composition')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'add-composition-line', entityType: 'ProductModule', idParam: 'id' })
  addComposition(@Param('id') id: string, @Body() dto: CreateCompositionLineDto) { return this.service.addComposition(id, dto); }

  @Patch(':id/composition/:lineId')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'update-composition-line', entityType: 'ProductModule', idParam: 'id' })
  updateComposition(@Param('id') id: string, @Param('lineId') lineId: string, @Body() dto: UpdateCompositionLineDto) { return this.service.updateComposition(id, lineId, dto); }

  @Delete(':id/composition/:lineId')
  @Roles('admin', 'manager')
  @HttpCode(HttpStatus.NO_CONTENT)
  @AuditAction({ action: 'remove-composition-line', entityType: 'ProductModule', idParam: 'id' })
  async removeComposition(@Param('id') id: string, @Param('lineId') lineId: string) { await this.service.removeComposition(id, lineId); }

  @Get(':id/tree')
  @Roles('admin', 'director', 'manager', 'user')
  getTree(@Param('id') id: string, @Query('maxDepth') maxDepth?: string) { return this.catalogGraph.getTree('module', id, maxDepth === undefined ? MAX_DEPTH : Number(maxDepth)); }

  @Get(':id/cost-preview')
  @Roles('admin', 'director', 'manager')
  @ApiOperation({ summary: 'Read-only recursive cost preview for a module (TZ-COST-302)' })
  @ApiResponse({ status: 200, description: '{ materialCost, laborCost, totalCost, currency: RUB }' })
  getCostPreview(@Param('id') id: string) { return this.service.getCostPreview(id); }

  @Get(':id')
  @Roles('admin', 'director', 'manager')
  findOne(@Param('id') id: string) { return this.service.findById(id); }

  @Post()
  @Roles('admin', 'manager')
  @AuditAction({ action: 'create', entityType: 'ProductModule' })
  create(@Body() dto: CreateProductModuleDto, @CurrentUser() user: AuthenticatedUser) {
    return this.service.create(dto as unknown as UpsertProductModuleDto, user.organizationId);
  }

  @Patch(':id')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'update', entityType: 'ProductModule', idParam: 'id' })
  update(@Param('id') id: string, @Body() dto: UpdateProductModuleDto, @CurrentUser() user: AuthenticatedUser) {
    return this.service.update(id, dto as unknown as Partial<UpsertProductModuleDto>, user.organizationId);
  }

  @Delete(':id')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'archive', entityType: 'ProductModule', idParam: 'id' })
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Archive a product module without hard delete' })
  @ApiResponse({ status: 204, description: 'Product module archived' })
  @ApiResponse({ status: 409, description: 'Product module is referenced by history' })
  remove(@Param('id') id: string) { return this.service.remove(id); }
}
