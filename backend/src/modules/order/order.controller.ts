import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseInterceptors,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { AuthenticatedUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { OrderService } from './order.service';
import { KitReserveService } from './kit-reserve.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderDto } from './dto/update-order.dto';
import { ShipOrderDto } from './dto/ship-order.dto';
import { SetOrderLineReadyDto } from './dto/set-order-line-ready.dto';
import { PatchEstimateDaysDto } from './dto/patch-estimate-days.dto';
import { PatchEstimateStartDto } from './dto/patch-estimate-start.dto';
import { PatchEstimateWorkerDto } from './dto/patch-estimate-worker.dto';
import { PatchLineBoardLaneDto } from './dto/patch-line-board-lane.dto';
import { PatchModuleLaneDto } from './dto/patch-module-lane.dto';
import { ReserveStockDto } from './dto/reserve-stock.dto';
import { AuditAction } from '../../common/decorators/audit-action.decorator';
import { RequireOrgScope } from '../../common/decorators/require-org-scope.decorator';
import { OrgScopeGuardInterceptor } from '../../common/interceptors/org-scope.interceptor';

@ApiTags('Закупки — Заказы')
@RequireOrgScope()
@UseInterceptors(OrgScopeGuardInterceptor)
@Controller('orders')
export class OrderController {
  constructor(
    private readonly service: OrderService,
    private readonly kitReserve: KitReserveService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List all orders with optional filters' })
  @ApiQuery({ name: 'counterpartyId', required: false, description: 'Filter by counterparty' })
  @ApiQuery({ name: 'status', required: false, description: 'Filter by status' })
  @ApiQuery({ name: 'managerId', required: false, description: 'Filter by manager' })
  @ApiResponse({ status: 200, description: 'List of orders' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  findAll(
    @Query('counterpartyId') counterpartyId?: string,
    @Query('status') status?: string,
    @Query('managerId') managerId?: string,
  ) {
    return this.service.findAll(counterpartyId, status, managerId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get order by ID' })
  @ApiResponse({ status: 200, description: 'Order found' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Order not found' })
  findOne(@Param('id') id: string) {
    return this.service.findById(id);
  }

  @Post()
  @Roles('admin', 'manager')
  @AuditAction({ action: 'create', entityType: 'Order' })
  @ApiOperation({ summary: 'Create a new order' })
  @ApiResponse({ status: 201, description: 'Order created' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  create(@Body() dto: CreateOrderDto) {
    return this.service.create(dto);
  }

  @Post(':id/stub-proposal')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'stub_proposal', entityType: 'Order' })
  @ApiOperation({
    summary: 'Создать черновик КП (заглушку) для прямого заказа — DEPRECATED',
    description:
      'DEPRECATED: не вызывать из UI — канон MASTER-CORE: заглушка КП не создаётся, ' +
      'прямой заказ живёт без КП. Endpoint остаётся только для совместимости со старыми ' +
      'клиентами. Идемпотентно: если у заказа уже есть КП, возвращает его с created=false. ' +
      'Организацию берём из JWT → «наша фирма» → единственная (TZ-PARTY-301).',
  })
  @ApiResponse({ status: 201, description: 'КП-заглушка создана или уже существовала' })
  @ApiResponse({ status: 400, description: 'Заказ отменён или без позиций' })
  @ApiResponse({ status: 404, description: 'Заказ не найден / «наша фирма» не настроена' })
  async createStubProposal(@Param('id') id: string, @CurrentUser() user?: AuthenticatedUser) {
    const { quotation, created } = await this.service.ensureStubProposal(
      id,
      user ? { organizationId: user.organizationId, role: user.role } : undefined,
    );
    return { quotationId: quotation._id.toString(), created, quotation };
  }

  @Patch(':id/items/:lineIndex/ready')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'line_ready', entityType: 'Order', idParam: 'id' })
  setLineReady(
    @Param('id') id: string,
    @Param('lineIndex') lineIndex: string,
    @Body() dto: SetOrderLineReadyDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.setLineReady(id, lineIndex, dto.readyForWork, user.id, user.organizationId);
  }

  @Patch(':id/items/:lineIndex/status')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'line_status', entityType: 'Order', idParam: 'id' })
  @ApiOperation({ summary: 'Change status of a specific order item' })
  @ApiResponse({ status: 200, description: 'Item status updated' })
  @ApiResponse({ status: 404, description: 'Order or line not found' })
  setItemStatus(
    @Param('id') id: string,
    @Param('lineIndex') lineIndex: string,
    @Body() body: { status: 'pending' | 'in_production' | 'ready' | 'shipped' },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.setItemStatus(id, lineIndex, body.status, user.organizationId);
  }

  @Patch(':id/lines/:lineId/lane')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'line_board_lane', entityType: 'Order', idParam: 'id' })
  @ApiOperation({
    summary: 'Сменить колонку Комбайна (boardLane) изделия',
    description:
      'Пишет boardLane + деривирует item.status; затем rollup Order.status. ' +
      'lane=shipped через PATCH запрещён — только POST /orders/:id/ship.',
  })
  @ApiResponse({ status: 200, description: 'Order with updated line lane + rollup status' })
  @ApiResponse({ status: 400, description: 'lane=shipped or hard-frozen order' })
  @ApiResponse({ status: 404, description: 'Order or line not found' })
  patchLineBoardLane(
    @Param('id') id: string,
    @Param('lineId') lineId: string,
    @Body() dto: PatchLineBoardLaneDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.patchLineBoardLane(id, lineId, dto.lane, user.organizationId);
  }

  @Patch(':id/lines/:lineId/modules/:moduleId/lane')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'module_board_lane', entityType: 'Order', idParam: 'id' })
  @ApiOperation({
    summary: 'Сменить колонку Комбайна (boardLane) модуля изделия',
    description:
      'Пишет разреженный moduleLanes по ключу (lineId, moduleId); полоса линии следует min. ' +
      'lane=shipped через PATCH запрещён — только POST /orders/:id/ship.',
  })
  @ApiResponse({ status: 200, description: 'Order with updated module lane + rollup status' })
  @ApiResponse({ status: 400, description: 'lane=shipped or hard-frozen order' })
  @ApiResponse({ status: 404, description: 'Order or line not found' })
  patchModuleLane(
    @Param('id') id: string,
    @Param('lineId') lineId: string,
    @Param('moduleId') moduleId: string,
    @Body() dto: PatchModuleLaneDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.patchModuleLane(id, lineId, moduleId, dto.lane, user.organizationId);
  }

  @Patch(':id/estimate-days')
  @Permissions('production:write')
  @AuditAction({ action: 'estimate_days', entityType: 'Order', idParam: 'id' })
  @ApiOperation({
    summary: 'Upsert or clear order-level estimate days override (Gantt)',
    description:
      'Composite key (orderItemIndex, moduleId, workTypeId). days: null removes override. ' +
      'Does not mutate WorkType catalog. Requires production:write (admin * passes).',
  })
  @ApiResponse({ status: 200, description: 'Order with updated estimateDayOverrides' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — missing production:write' })
  @ApiResponse({ status: 404, description: 'Order or line not found' })
  patchEstimateDays(
    @Param('id') id: string,
    @Body() dto: PatchEstimateDaysDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.patchEstimateDays(id, dto, user.organizationId);
  }

  @Patch(':id/estimate-start')
  @Permissions('production:write')
  @AuditAction({ action: 'estimate_start', entityType: 'Order', idParam: 'id' })
  @ApiOperation({
    summary: 'Upsert or clear per-bar Gantt start offset (parallel)',
    description:
      'Composite key (orderItemIndex, moduleId, workTypeId). offsetDays from visualAnchor; null clears. ' +
      'Requires production:write (admin * passes).',
  })
  @ApiResponse({ status: 200, description: 'Order with updated estimateStartOffsets' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — missing production:write' })
  @ApiResponse({ status: 404, description: 'Order or line not found' })
  patchEstimateStart(
    @Param('id') id: string,
    @Body() dto: PatchEstimateStartDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.patchEstimateStart(id, dto, user.organizationId);
  }

  @Patch(':id/estimate-worker')
  @Permissions('production:write')
  @AuditAction({ action: 'estimate_worker', entityType: 'Order', idParam: 'id' })
  @ApiOperation({
    summary: 'Upsert or clear job-assignment override for one WT line (Gantt)',
    description:
      'Composite key (orderItemIndex, moduleId, workTypeId). workerIds: [] clears the override ' +
      '(falls back to «Не назначен», never auto-fills from Worker.workTypeIds skills). ' +
      'Requires production:write (admin * passes).',
  })
  @ApiResponse({ status: 200, description: 'Order with updated estimateWorkerOverrides' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — missing production:write' })
  @ApiResponse({ status: 404, description: 'Order or line not found' })
  patchEstimateWorker(
    @Param('id') id: string,
    @Body() dto: PatchEstimateWorkerDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.patchEstimateWorker(id, dto, user.organizationId);
  }

  @Patch(':id')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'update', entityType: 'Order' })
  @ApiOperation({ summary: 'Update an existing order' })
  @ApiResponse({ status: 200, description: 'Order updated' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Order not found' })
  update(@Param('id') id: string, @Body() dto: UpdateOrderDto, @CurrentUser() user: AuthenticatedUser) {
    return this.service.update(id, dto, user.organizationId);
  }

  @Get(':id/items/:itemIndex/kit-availability')
  @Roles('admin', 'manager')
  @ApiOperation({
    summary: 'Проверить комплектацию изделия в заказе (материалы из состава: модуль/продукт)',
    description:
      'Материалы берутся из существующего снимка состава (dual-read composition/legacy), ' +
      'не из отдельной BOM-модели. Доступность агрегируется по складским остаткам материала.',
  })
  @ApiResponse({ status: 200, description: 'Список материалов need/available/status + summary' })
  @ApiResponse({ status: 400, description: 'Нет состава для комплектации' })
  @ApiResponse({ status: 404, description: 'Order or line not found' })
  getKitAvailability(
    @Param('id') id: string,
    @Param('itemIndex') itemIndex: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.kitReserve.getAvailability(id, Number(itemIndex), user.organizationId);
  }

  @Post(':id/items/:itemIndex/kit-reserve')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'kit_reserve', entityType: 'Order', idParam: 'id' })
  @ApiOperation({
    summary: 'Подтвердить комплектацию: reserve ok-материалы атомарно; short → SupplyRequest (не hard-stop)',
    description:
      'Soft shortage: line с нехваткой не резервируется частично — вместо этого создаётся ' +
      'SupplyRequest на дефицит. Не списывает со склада (OUT) — это successor TZ.',
  })
  @ApiResponse({ status: 200, description: '{ reserved, supplyRequestIds, warnings }' })
  @ApiResponse({ status: 400, description: 'Нет состава для комплектации' })
  @ApiResponse({ status: 404, description: 'Order or line not found' })
  confirmKitReserve(
    @Param('id') id: string,
    @Param('itemIndex') itemIndex: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.kitReserve.confirmReserve(id, Number(itemIndex), user.organizationId);
  }

  @Post(':id/reserve-stock')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'reserve_stock', entityType: 'Order' })
  @ApiOperation({ summary: 'Reserve stock for an order' })
  @ApiResponse({ status: 200, description: 'Stock reserved' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Order not found' })
  reserveStock(
    @Param('id') id: string,
    @Body() dto: ReserveStockDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.reserveStock(id, dto.warehouseId, dto.zoneName, user.organizationId);
  }

  @Post(':id/ship')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'ship', entityType: 'Order' })
  @ApiOperation({ summary: 'Ship an order' })
  @ApiResponse({ status: 200, description: 'Order shipped' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Order not found' })
  ship(
    @Param('id') id: string,
    @Body() body: ShipOrderDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.ship(
      id,
      body?.recipient,
      body?.address,
      body?.warehouseId,
      body?.driverInfo,
      body?.items,
      user.organizationId,
    );
  }

  @Post(':id/cancel')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'cancel', entityType: 'Order' })
  @ApiOperation({ summary: 'Cancel an order' })
  @ApiResponse({ status: 200, description: 'Order cancelled' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Order not found' })
  cancel(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.cancel(id, user.organizationId);
  }

  @Delete(':id')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'delete', entityType: 'Order' })
  @ApiOperation({ summary: 'Delete an order' })
  @ApiResponse({ status: 200, description: 'Order deleted' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Order not found' })
  remove(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.remove(id, user.organizationId);
  }
}
