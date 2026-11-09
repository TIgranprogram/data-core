import { MoneyMaskInterceptor } from '../../common/interceptors/money-mask.interceptor';
import { withPartsOf } from '../../common/catalog/stock-visible';
import { AppSection } from '../../common/decorators/app-section.decorator';
import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, UseInterceptors } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { AuditAction } from '../../common/interceptors/audit.interceptor';
import { Roles } from '../../common/decorators/roles.decorator';
import { StockScoped } from '../../common/decorators/stock-scoped.decorator';
import type { StockScope } from '../../common/stock-scope';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { CreateCompositionLineDto, UpdateCompositionLineDto } from '../../common/catalog/composition-line.dto';
import { CatalogGraphService, MAX_DEPTH } from '../../common/catalog/catalog-graph.service';
import { CreateMaterialDto, MATERIAL_KINDS } from './dto/create-material.dto';
import { UpdateMaterialDto } from './dto/update-material.dto';
import { MaterialService } from './material.service';
import { MaterialPriceService } from './material-price.service';

@ApiTags('Справочники — Материалы')
@AppSection('stock')
@UseInterceptors(MoneyMaskInterceptor)
@Controller('materials')
export class MaterialController {
  constructor(
    private readonly service: MaterialService,
    private readonly catalogGraph: CatalogGraphService,
    private readonly prices: MaterialPriceService,
  ) {}

  @Get()
  @Roles('admin', 'director', 'manager')
  @ApiOperation({ summary: 'List all materials with pagination and filters' })
  @ApiQuery({ name: 'page', required: false, description: 'Page number' })
  @ApiQuery({ name: 'limit', required: false, description: 'Items per page' })
  @ApiQuery({ name: 'search', required: false, description: 'Search by name' })
  @ApiQuery({ name: 'categoryId', required: false, description: 'Filter by category' })
  @ApiQuery({ name: 'materialKind', required: false, enum: MATERIAL_KINDS, description: 'Filter by catalog kind' })
  @ApiQuery({ name: 'withParts', required: false, description: '1 — показать и детали из PDM, и сортаменты (по умолчанию скрыты)' })
  @ApiResponse({ status: 200, description: 'Paginated list of materials' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  list(@CurrentUser() user: AuthenticatedUser, @StockScoped() scope: StockScope | null, @Query('page') page = '1', @Query('limit') limit = '20', @Query('search') search?: string, @Query('categoryId') categoryId?: string, @Query('materialKind') materialKind?: CreateMaterialDto['materialKind'], @Query('withParts') withParts?: string) {
    return this.service.findAll({ page: parseInt(page, 10), limit: parseInt(limit, 10), search, categoryId, materialKind, withParts: withPartsOf(withParts) }, user.organizationId, scope);
  }

  @AppSection('stock', 'requests')
  @Get(':id/prices')
  @Roles('admin', 'director', 'manager')
  @ApiOperation({ summary: 'История закупочных цен материала (без НДС)' })
  async getPrices(@Param('id') id: string, @Query() q: Record<string, unknown>, @StockScoped() scope: StockScope | null) {
    await this.service.assertInScope([id], scope);
    return this.prices.list(id, q);
  }

  @AppSection('stock', 'requests')
  @Get(':id/price-default')
  @Roles('admin', 'director', 'manager')
  @ApiOperation({ summary: 'Последняя цена и поставщик — для подстановки в заявку' })
  async getPriceDefault(@Param('id') id: string, @StockScoped() scope: StockScope | null) {
    await this.service.assertInScope([id], scope);
    return this.prices.defaultFor(id);
  }

  @Get(':id/where-used')
  @Roles('admin', 'director', 'manager', 'user')
  @ApiOperation({ summary: 'List catalog parents that use this material' })
  @ApiQuery({ name: 'page', required: false, description: 'Page number' })
  @ApiQuery({ name: 'limit', required: false, description: 'Page size, max 100' })
  async getWhereUsed(@Param('id') id: string, @StockScoped() scope: StockScope | null, @Query('page') page = '1', @Query('limit') limit = '20', @CurrentUser() user: AuthenticatedUser) {
    await this.service.assertInScope([id], scope);
    return this.service.getWhereUsed(id, { page: parseInt(page, 10), limit: parseInt(limit, 10), organizationId: user.organizationId });
  }

  @Get(':id/composition')
  @Roles('admin', 'director', 'manager', 'user')
  @ApiOperation({ summary: 'Deталь BOM: raw materials in this part (TZ-NX-DETAIL-MATERIAL-BOM)' })
  async getComposition(@Param('id') id: string, @StockScoped() scope: StockScope | null, @CurrentUser() user: AuthenticatedUser) {
    await this.service.assertInScope([id], scope);
    return this.service.getComposition(id, user.organizationId);
  }

  @Post(':id/composition')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'add-composition-line', entityType: 'Material', idParam: 'id' })
  async addComposition(
    @Param('id') id: string,
    @Body() dto: CreateCompositionLineDto,
    @StockScoped() scope: StockScope | null,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.service.assertInScope([id], scope);
    return this.service.addComposition(id, dto, user.organizationId);
  }

  @Patch(':id/composition/:lineId')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'update-composition-line', entityType: 'Material', idParam: 'id' })
  async updateComposition(
    @Param('id') id: string,
    @Param('lineId') lineId: string,
    @Body() dto: UpdateCompositionLineDto,
    @StockScoped() scope: StockScope | null,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.service.assertInScope([id], scope);
    return this.service.updateComposition(id, lineId, dto, user.organizationId);
  }

  @Delete(':id/composition/:lineId')
  @Roles('admin', 'manager')
  @HttpCode(HttpStatus.NO_CONTENT)
  @AuditAction({ action: 'remove-composition-line', entityType: 'Material', idParam: 'id' })
  async removeComposition(
    @Param('id') id: string,
    @Param('lineId') lineId: string,
    @StockScoped() scope: StockScope | null,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.service.assertInScope([id], scope);
    await this.service.removeComposition(id, lineId, user.organizationId);
  }

  @Get(':id/tree')
  @Roles('admin', 'director', 'manager', 'user')
  async getTree(@Param('id') id: string, @StockScoped() scope: StockScope | null, @Query('maxDepth') maxDepth?: string) {
    await this.service.assertInScope([id], scope);
    return this.catalogGraph.getTree('material', id, maxDepth === undefined ? MAX_DEPTH : Number(maxDepth));
  }

  @Get(':id')
  @Roles('admin', 'director', 'manager', 'user')
  async findOne(@Param('id') id: string, @StockScoped() scope: StockScope | null, @CurrentUser() user: AuthenticatedUser) {
    await this.service.assertInScope([id], scope);
    return this.service.findById(id, user.organizationId);
  }

  @Post()
  @Roles('admin', 'manager')
  @AuditAction({ action: 'create', entityType: 'Material' })
  async create(@Body() dto: CreateMaterialDto, @StockScoped() scope: StockScope | null, @CurrentUser() user: AuthenticatedUser) {
    await this.service.assertNewInScope(dto.categoryId, scope);
    return this.service.create(dto, user.organizationId);
  }

  @Patch(':id')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'update', entityType: 'Material', idParam: 'id' })
  async update(@Param('id') id: string, @Body() dto: UpdateMaterialDto, @StockScoped() scope: StockScope | null, @CurrentUser() user: AuthenticatedUser) {
    await this.service.assertInScope([id], scope);
    if (dto.categoryId) await this.service.assertNewInScope(dto.categoryId, scope);
    return this.service.update(id, dto, user.organizationId);
  }

  @Patch(':id/passport-spec')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'passport-spec', entityType: 'Material', idParam: 'id' })
  @ApiOperation({ summary: 'МЦ-2: связь позиции склада с материалом паспорта (materialId, sizes, isCoating, passportText, techText)' })
  async setPassportSpec(@Param('id') id: string, @Body() body: Record<string, unknown>, @StockScoped() scope: StockScope | null, @CurrentUser() user: AuthenticatedUser) {
    await this.service.assertInScope([id], scope);
    return this.service.setPassportSpec(id, body, user.organizationId);
  }

  @Delete(':id')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'delete', entityType: 'Material', idParam: 'id' })
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string, @StockScoped() scope: StockScope | null, @CurrentUser() user: AuthenticatedUser) {
    await this.service.assertInScope([id], scope);
    return this.service.remove(id, user.organizationId);
  }

  @Post(':id/duplicate')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'duplicate', entityType: 'Material', idParam: 'id' })
  @HttpCode(HttpStatus.CREATED)
  async duplicate(@Param('id') id: string, @StockScoped() scope: StockScope | null, @CurrentUser() user: AuthenticatedUser) {
    await this.service.assertInScope([id], scope);
    return this.service.duplicate(id, user.organizationId);
  }
}
