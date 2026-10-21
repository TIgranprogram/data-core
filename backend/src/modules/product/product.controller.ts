import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { AuditAction } from '../../common/interceptors/audit.interceptor';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { DuplicateProductDto } from './dto/duplicate-product.dto';
import { CreateCompositionLineDto, UpdateCompositionLineDto } from '../catalog/composition-line.dto';
import { CatalogGraphService, MAX_DEPTH } from '../catalog-graph/catalog-graph.service';
import { ProductService } from './product.service';

@ApiTags('Справочники — Продукты')
@Controller('products')
export class ProductController {
  constructor(private readonly service: ProductService, private readonly catalogGraph: CatalogGraphService) {}
  @Get() @Roles('admin', 'director', 'manager') @ApiOperation({ summary: 'List all products with pagination and filters' }) @ApiQuery({ name: 'page', required: false }) @ApiQuery({ name: 'limit', required: false }) @ApiQuery({ name: 'search', required: false }) @ApiQuery({ name: 'categoryId', required: false }) @ApiQuery({ name: 'status', required: false }) @ApiQuery({ name: 'isActive', required: false }) @ApiQuery({ name: 'sortBy', required: false }) @ApiQuery({ name: 'sortOrder', required: false }) @ApiResponse({ status: 200, description: 'Paginated list of products' })
  list(@CurrentUser() user: AuthenticatedUser, @Query('page') page = '1', @Query('limit') limit = '20', @Query('search') search?: string, @Query('categoryId') categoryId?: string, @Query('status') status?: string, @Query('isActive') isActive?: string, @Query('isComplex') isComplex?: string, @Query('sortBy') sortBy?: string, @Query('sortOrder') sortOrder?: 'asc' | 'desc') { return this.service.findAll({ page: parseInt(page, 10), limit: parseInt(limit, 10), search, categoryId, status, isActive: isActive === 'true' ? true : isActive === 'false' ? false : undefined, isComplex: isComplex === 'true' ? true : isComplex === 'false' ? false : undefined, sortBy, sortOrder }, user.organizationId); }
  @Get('bulk')
  @Roles('admin', 'director', 'manager', 'user')
  @ApiOperation({ summary: 'Get multiple products by IDs' })
  @ApiQuery({ name: 'ids', required: true, description: 'Comma-separated list of product IDs' })
  async findByIds(@Query('ids') ids: string, @CurrentUser() user: AuthenticatedUser) {
    if (!ids) return [];
    const idArray = ids.split(',').filter(Boolean);
    if (idArray.length === 0) return [];
    return this.service.findByIds(idArray, user.organizationId);
  }

  @Get(':id/where-used') @Roles('admin', 'director', 'manager', 'user') getWhereUsed(@Param('id') id: string, @Query('page') page = '1', @Query('limit') limit = '20', @CurrentUser() user: AuthenticatedUser) { return this.catalogGraph.getWhereUsed('product', id, { page: parseInt(page, 10), limit: parseInt(limit, 10), organizationId: user.organizationId }); }
  @Post(':id/duplicate') @Roles('admin', 'manager') @ApiOperation({ summary: 'Создать безопасную копию изделия' }) @ApiResponse({ status: 201, description: 'Новая копия Product в scope организации' }) @ApiResponse({ status: 409, description: 'Заданный артикул уже занят' }) @AuditAction({ action: 'duplicate', entityType: 'Product', idParam: 'id' }) duplicate(@Param('id') id: string, @Body() dto: DuplicateProductDto, @CurrentUser() user: AuthenticatedUser) { return this.service.duplicate(id, dto, user.organizationId); }
  @Get(':id/composition') @Roles('admin', 'director', 'manager', 'user') getComposition(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) { return this.service.getComposition(id, user.organizationId); }
  @Post(':id/composition') @Roles('admin', 'manager') @AuditAction({ action: 'add-composition-line', entityType: 'Product', idParam: 'id' }) addComposition(@Param('id') id: string, @Body() dto: CreateCompositionLineDto, @CurrentUser() user: AuthenticatedUser) { return this.service.addComposition(id, dto, user.organizationId); }
  @Patch(':id/composition/:lineId') @Roles('admin', 'manager') @AuditAction({ action: 'update-composition-line', entityType: 'Product', idParam: 'id' }) updateComposition(@Param('id') id: string, @Param('lineId') lineId: string, @Body() dto: UpdateCompositionLineDto, @CurrentUser() user: AuthenticatedUser) { return this.service.updateComposition(id, lineId, dto, user.organizationId); }
  @Delete(':id/composition/:lineId') @Roles('admin', 'manager') @HttpCode(HttpStatus.NO_CONTENT) @AuditAction({ action: 'remove-composition-line', entityType: 'Product', idParam: 'id' }) async removeComposition(@Param('id') id: string, @Param('lineId') lineId: string, @CurrentUser() user: AuthenticatedUser) { await this.service.removeComposition(id, lineId, user.organizationId); }
  @Get(':id/tree') @Roles('admin', 'director', 'manager', 'user') getTree(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser, @Query('maxDepth') maxDepth?: string) { return this.service.getTree(id, maxDepth === undefined ? MAX_DEPTH : Number(maxDepth), user.organizationId); }
  @Get(':id') @Roles('admin', 'director', 'manager', 'user') findOne(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) { return this.service.findById(id, user.organizationId); }
  @Post() @Roles('admin', 'manager') @AuditAction({ action: 'create', entityType: 'Product' }) create(@Body() dto: CreateProductDto, @CurrentUser() user: AuthenticatedUser) { return this.service.create(dto, user.organizationId); }
  @Patch(':id') @Roles('admin', 'manager') @AuditAction({ action: 'update', entityType: 'Product', idParam: 'id' }) update(@Param('id') id: string, @Body() dto: UpdateProductDto, @CurrentUser() user: AuthenticatedUser) { return this.service.update(id, dto, user.organizationId); }
  @Delete(':id') @Roles('admin', 'manager') @AuditAction({ action: 'archive', entityType: 'Product', idParam: 'id' }) @HttpCode(HttpStatus.NO_CONTENT) @ApiResponse({ status: 409, description: 'Product is referenced by history' }) remove(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) { return this.service.remove(id, user.organizationId); }
  @Post(':productId/modules') @Roles('admin', 'manager') @AuditAction({ action: 'attach-module', entityType: 'Product', idParam: 'productId' }) attachModule(@Param('productId') productId: string, @Body() body: { moduleId: string }) { return this.service.attachModule(productId, body.moduleId); }
  @Delete(':productId/modules/:moduleId') @Roles('admin', 'manager') @AuditAction({ action: 'detach-module', entityType: 'Product', idParam: 'productId' }) @HttpCode(HttpStatus.NO_CONTENT) detachModule(@Param('productId') productId: string, @Param('moduleId') moduleId: string) { return this.service.detachModule(productId, moduleId); }
}
