import { MoneyMaskInterceptor } from '../../common/interceptors/money-mask.interceptor';
import { AppSection } from '../../common/decorators/app-section.decorator';
import { Throttle } from '@nestjs/throttler';
import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiQuery, ApiTags } from '@nestjs/swagger';
import { AuditAction } from '../../common/decorators/audit-action.decorator';
import { ConfirmTokenGuard } from '../../common/guards/confirm-token.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { canSeeMoney } from '../../common/roles-hierarchy';
import { CurrentUser, type AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { StockCorrectDto, StockBatchDto, StockCompositionAcceptDto, StockIssueDto, StockIssueOrderDto, StockItemDto, StockOffcutDto, StockMoveDto, StockPhotoDto, StockReservationUpdateDto, StockReserveListDto, StockSpecApplyDto, StockSpecPreviewDto } from './dto';
import { StockScoped } from '../../common/decorators/stock-scoped.decorator';
import { narrowToZone, type StockScope } from '../../common/stock-scope';
import { StockZonesService } from '../stock-zones/stock-zones.service';
import { StockService } from './stock.service';

/**
 * Склад на общих коллекциях CRM (materials + storageitems + stockmovements + reservations).
 * Роли — как в CRM kppdf: читать могут все, менять — admin и manager.
 */
@ApiTags('Склад')
@AppSection('stock')
@UseInterceptors(MoneyMaskInterceptor)
@Controller('stock')
export class StockController {
  constructor(private readonly stock: StockService, private readonly zones: StockZonesService) {}

  @Get('warehouses')
  @Roles('admin', 'director', 'manager', 'user')
  warehouses() {
    return this.stock.listWarehouses();
  }

  /** Склады (зоны доступа), доступные пользователю: `{items:[{id,name,isDefault,order}]}` — для переключателя склада (один — скрыть). Остальные списки принимают `zoneId`. */
  @Get('zones')
  @Roles('admin', 'director', 'manager', 'user')
  zoneList(@CurrentUser() user?: AuthenticatedUser) {
    return this.zones.forUser(user);
  }

  /** Позиции склада по умолчанию: материал + остаток / бронь / свободно; counts — для чипов «к закупке / нет / в брони». */
  @Get('items')
  @Roles('admin', 'director', 'manager', 'user')
  @ApiQuery({ name: 'page', required: false }) @ApiQuery({ name: 'limit', required: false, description: '≤1000, по умолчанию 1000' })
  @ApiQuery({ name: 'search', required: false, description: 'наименование, артикул, код, примечание' })
  @ApiQuery({ name: 'sort', required: false, description: 'name | categoryName | unit | article | quantity | reservedQty | free | minQuantity | status | updatedAt | deletedAt; «-» — по убыванию' })
  @ApiQuery({ name: 'status', required: false, description: 'через запятую: ok, low, none, reserved' })
  @ApiQuery({ name: 'priority', required: false, description: '1 — «заканчивается» и «в брони» сверху' })
  @ApiQuery({ name: 'grade', required: false, description: 'марка стали' }) @ApiQuery({ name: 'section', required: false, description: 'сортамент / сечение' }) @ApiQuery({ name: 'thickness', required: false, description: 'толщина, мм' })
  @ApiQuery({ name: 'categoryId', required: false }) @ApiQuery({ name: 'deleted', required: false, description: '1 — корзина' })
  @ApiQuery({ name: 'zoneId', required: false, description: 'склад из GET /stock/zones; чужой — 403' })
  list(@Query() q: Record<string, string>, @StockScoped() own: StockScope | null) {
    const scope = narrowToZone(own, q.zoneId);
    return this.stock.listItems(scope ? q : { ...q, hideEmptyMetal: '1' }, scope);
  }

  /** SK-8d: короткий список позиций для выбора из «Заявок» и «Продукции» (без фото, броней, заявок) — `{items}`. */
  @AppSection('stock', 'requests', 'products')
  @Get('lookup')
  @Roles('admin', 'director', 'manager', 'user')
  lookup(@Query('zoneId') zoneId: string | undefined, @StockScoped() own: StockScope | null) {
    return this.stock.lookup(narrowToZone(own, zoneId));
  }

  /** Сводка по категориям: позиций всего / к закупке / нет на складе. */
  @Get('categories')
  @Roles('admin', 'director', 'manager', 'user')
  categories(@Query('zoneId') zoneId: string | undefined, @StockScoped() own: StockScope | null) {
    return this.stock.categorySummary(narrowToZone(own, zoneId));
  }

  /** Журнал движений по всем позициям. */
  @Get('movements')
  @Roles('admin', 'director', 'manager', 'user')
  @ApiQuery({ name: 'page', required: false }) @ApiQuery({ name: 'limit', required: false, description: '≤500, по умолчанию 50' })
  @ApiQuery({ name: 'type', required: false, description: 'in, out, adjust (через запятую)' })
  @ApiQuery({ name: 'from', required: false }) @ApiQuery({ name: 'to', required: false }) @ApiQuery({ name: 'materialId', required: false })
  @ApiQuery({ name: 'search', required: false, description: 'наименование позиции или примечание' })
  @ApiQuery({ name: 'personId', required: false, description: 'кому выдано (persons.id)' }) @ApiQuery({ name: 'salesOrderId', required: false, description: 'под заказ (через запятую)' })
  @ApiQuery({ name: 'sort', required: false, description: 'date | qty | type | createdAt (умолч. -date)' })
  movements(@Query() q: Record<string, string>, @StockScoped() own: StockScope | null) {
    return this.stock.listMovements(q, narrowToZone(own, q.zoneId));
  }

  /** Исправить списание (СМ.5): отмена + новое списание с тем же «кому» и «под что». */
  @Post('movements/:id/correct')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'stock.movement.corrected', entityType: 'StockMovement', idParam: 'id' })
  async correctMovement(@Param('id') id: string, @Body() dto: StockCorrectDto, @StockScoped() scope: StockScope | null, @CurrentUser() user?: AuthenticatedUser) {
    if (scope) await this.stock.assertInScope([await this.stock.movementMaterialId(id)], scope);
    return this.stock.correctMovement(id, dto.qty, user?.id);
  }

  /** Отменить движение: проводится обратное, исходное помечается отменённым. */
  @Post('movements/:id/cancel')
  @HttpCode(200)
  @Roles('admin', 'manager')
  @AuditAction({ action: 'stock.movement.cancelled', entityType: 'StockMovement', idParam: 'id' })
  async cancelMovement(@Param('id') id: string, @StockScoped() scope: StockScope | null, @CurrentUser() user?: AuthenticatedUser) {
    if (scope) await this.stock.assertInScope([await this.stock.movementMaterialId(id)], scope);
    return this.stock.cancelMovement(id, user?.id);
  }

  @Get('items/:id')
  @Roles('admin', 'director', 'manager', 'user')
  get(@Param('id') id: string, @StockScoped() scope: StockScope | null) {
    return this.stock.getItem(id, scope);
  }

  @Get('items/:id/history')
  @Roles('admin', 'director', 'manager', 'user')
  @ApiQuery({ name: 'limit', required: false, description: 'только последние N записей (1–200); total — всего записей' })
  history(@Param('id') id: string, @StockScoped() scope: StockScope | null, @Query('limit') limit?: string) {
    return this.stock.history(id, limit ? Number(limit) : undefined, scope);
  }

  /** Новая позиция (материал + строка остатка). Такое же наименование — вернётся существующая. */
  @AppSection('stock', 'requests')
  @Post('items')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'stock.item.created', entityType: 'Material' })
  async create(@Body() dto: StockItemDto, @StockScoped() scope: StockScope | null) {
    return this.stock.createItem(scope ? await this.stock.scopeNewItem(dto, scope) : dto, scope);
  }

  @Patch('items/:id')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'stock.item.updated', entityType: 'Material', idParam: 'id' })
  async update(@Param('id') id: string, @Body() dto: StockItemDto, @StockScoped() scope: StockScope | null) {
    await this.stock.assertInScope([id], scope);
    if (scope && (dto.categoryId || dto.categoryName)) await this.stock.scopeNewItem({ ...dto, name: dto.name ?? '' }, scope); // перенос в чужую категорию — 403
    return this.stock.updateItem(id, dto);
  }

  @AppSection('stock', 'requests')
  @Post('items/:id/photos')
  @Roles('admin', 'manager')
  async photo(@Param('id') id: string, @Body() dto: StockPhotoDto, @StockScoped() scope: StockScope | null) {
    await this.stock.assertInScope([id], scope);
    return this.stock.addPhoto(id, dto.photoId);
  }

  @Put('items/:id/photos/:photoId/main')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'stock.item.photo.main', entityType: 'Material', idParam: 'id' })
  async mainPhoto(@Param('id') id: string, @Param('photoId') photoId: string, @StockScoped() scope: StockScope | null) {
    await this.stock.assertInScope([id], scope);
    return this.stock.mainPhoto(id, photoId);
  }

  /** Убрать фото позиции (главное — следующее по списку). */
  @Delete('items/:id/photos/:photoId')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'stock.item.photo.removed', entityType: 'Material', idParam: 'id' })
  async removePhoto(@Param('id') id: string, @Param('photoId') photoId: string, @StockScoped() scope: StockScope | null) {
    await this.stock.assertInScope([id], scope);
    return this.stock.removePhoto(id, photoId);
  }

  /** Бронь по списку (спецификация): бронирует сколько свободно, нехватку возвращает в short. */
  @Post('reserve-list')
  @Roles('admin', 'manager')
  @Throttle({ short: { ttl: 60_000, limit: 30 } }) // М8: массовая операция — не чаще 30 в минуту
  @AuditAction({ action: 'stock.reserve.list', entityType: 'StockMovement' })
  async reserveList(@Body() dto: StockReserveListDto, @StockScoped() scope: StockScope | null, @CurrentUser() user?: AuthenticatedUser) {
    await this.stock.assertInScope(dto.lines.map((l) => l.materialId), scope);
    return this.stock.reserveList(dto, user?.id);
  }

  /** Активные брони по названиям. */
  @Get('reservations')
  @Roles('admin', 'director', 'manager', 'user')
  reservations(@Query('zoneId') zoneId: string | undefined, @StockScoped() own: StockScope | null) {
    return this.stock.listReservations(narrowToZone(own, zoneId));
  }

  /** Карточка брони: что забронировано, сколько выдано и кому, под какой заказ, заявки на недостающее. key — batchId или id брони. */
  @Get('reservations/group/:key')
  @Roles('admin', 'director', 'manager', 'user')
  reservationDetail(@Param('key') key: string, @StockScoped() scope: StockScope | null) {
    return this.stock.reservationDetail(key, scope);
  }

  /** «Выдать по брони»: списание по броням (целиком или частично), кому выдано. */
  @Post('reservations/issue')
  @HttpCode(200)
  @Roles('admin', 'manager')
  @AuditAction({ action: 'stock.reserve.issued', entityType: 'StockMovement' })
  async issueReservations(@Body() dto: StockIssueDto, @StockScoped() scope: StockScope | null, @CurrentUser() user?: AuthenticatedUser) {
    await this.stock.assertReservationsInScope({ ids: dto.lines.map((l) => l.reservationId) }, scope);
    return this.stock.issueReservations(dto, user?.id);
  }

  /** Брони заказа для «Выдать по заказу» (SK-6): активные брони, остаток на складе, «висящий» ли заказ. */
  @AppSection('stock', 'salesorders')
  @Get('reservations/order/:salesOrderId')
  @Roles('admin', 'director', 'manager', 'user')
  reservationsByOrder(@Param('salesOrderId') salesOrderId: string, @StockScoped() scope: StockScope | null) {
    return this.stock.reservationsByOrder(salesOrderId, scope);
  }

  /** «Выдать по заказу» (SK-6): все активные брони заказа или выбранные — одной пачкой; отмена — `batch/:batchId/cancel`. */
  @Post('reservations/issue-order')
  @HttpCode(200)
  @Roles('admin', 'manager')
  @Throttle({ short: { ttl: 60_000, limit: 30 } })
  @AuditAction({ action: 'stock.reserve.issued.order', entityType: 'StockMovement' })
  async issueOrder(@Body() dto: StockIssueOrderDto, @StockScoped() scope: StockScope | null, @CurrentUser() user?: AuthenticatedUser) {
    await this.stock.assertReservationsInScope({ ids: dto.lines?.map((l) => l.reservationId) ?? dto.reservationIds, salesOrderId: dto.salesOrderId }, scope);
    return this.stock.issueOrder(dto, user?.id);
  }

  /** Правка брони (SK-6): количество, заказ, позиция заказа, примечание — права как у создания брони. */
  @Patch('reservations/:id')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'stock.reserve.updated', entityType: 'Reservation', idParam: 'id' })
  async updateReservation(@Param('id') id: string, @Body() dto: StockReservationUpdateDto, @StockScoped() scope: StockScope | null) {
    await this.stock.assertReservationsInScope({ ids: [id] }, scope);
    return this.stock.updateReservation(id, dto);
  }

  @AppSection('stock', 'salesorders')
  @Post('reservations/:id/release')
  @HttpCode(200)
  @Roles('admin', 'manager')
  @AuditAction({ action: 'stock.reserve.released', entityType: 'StockMovement' })
  async releaseReservation(@Param('id') id: string, @StockScoped() scope: StockScope | null) {
    await this.stock.assertReservationsInScope({ ids: [id] }, scope);
    return this.stock.releaseReservation(id);
  }

  @Post('reservations/group/:batchId/release')
  @HttpCode(200)
  @Roles('admin', 'manager')
  @AuditAction({ action: 'stock.reserve.group.released', entityType: 'StockMovement' })
  releaseGroup(@Param('batchId') batchId: string, @StockScoped() scope: StockScope | null) {
    return this.stock.releaseGroup(batchId, scope);
  }

  /** Спецификация из Excel, просмотр (SK-6): строки файла → позиции склада, хватает ли свободного. Ничего не пишет. */
  @AppSection('stock', 'salesorders')
  @Post('spec/preview')
  @HttpCode(200)
  @Roles('admin', 'manager')
  @Throttle({ short: { ttl: 60_000, limit: 30 } })
  specPreview(@Body() dto: StockSpecPreviewDto, @StockScoped() scope: StockScope | null) {
    return this.stock.specPreview(dto, scope);
  }

  /** Спецификация из Excel, запись (SK-6): подтверждённые строки → брони одной пачкой; replace — снять прежнюю загрузку. */
  @AppSection('stock', 'salesorders')
  @Post('spec/apply')
  @HttpCode(200)
  @Roles('admin', 'manager')
  @Throttle({ short: { ttl: 60_000, limit: 30 } })
  @AuditAction({ action: 'stock.spec.applied', entityType: 'StockMovement' })
  specApply(@Body() dto: StockSpecApplyDto, @StockScoped() scope: StockScope | null, @CurrentUser() user?: AuthenticatedUser) {
    return this.stock.specApply(dto, user?.id, scope);
  }

  /** Пакет: списать / принять / пересчитать несколько позиций одной операцией (всё или ничего). */
  @Post('batch')
  @Roles('admin', 'manager')
  @Throttle({ short: { ttl: 60_000, limit: 30 } }) // М8: массовая операция — не чаще 30 в минуту
  @AuditAction({ action: 'stock.batch', entityType: 'StockMovement' })
  async batch(@Body() dto: StockBatchDto, @StockScoped() scope: StockScope | null, @CurrentUser() user?: AuthenticatedUser) {
    await this.stock.assertInScope(dto.lines.map((l) => l.materialId), scope);
    return this.stock.batch(dto, user?.id);
  }

  /** Отменить пакет целиком (обратные движения; история не стирается). */
  @Post('batch/:batchId/cancel')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'stock.batch.cancelled', entityType: 'StockMovement' })
  cancelBatch(@Param('batchId') batchId: string, @StockScoped() scope: StockScope | null, @CurrentUser() user?: AuthenticatedUser) {
    return this.stock.cancelBatch(batchId, user?.id, scope);
  }

  /** Состав изделия из выдач (SK-7): нетто выдач под позицию ÷ число изделий, разница с составом; цены — только деньговым ролям. Ничего не хранит. */
  @AppSection('stock', 'products', 'salesorders')
  @Get('composition-suggest')
  @Roles('admin', 'director', 'manager', 'user')
  @ApiQuery({ name: 'salesOrderLineId', required: true, description: 'позиция заказа (incomes.id)' })
  compositionSuggest(@Query('salesOrderLineId') salesOrderLineId: string, @StockScoped() scope: StockScope | null, @CurrentUser() user?: AuthenticatedUser) {
    return this.stock.compositionSuggest(salesOrderLineId, canSeeMoney(user), scope);
  }

  /** Принять предложение в состав изделия (как «Изменить состав»); повтор не удваивает, строки не удаляются. */
  @AppSection('stock', 'products', 'salesorders')
  @Post('composition-suggest/accept')
  @HttpCode(200)
  @Roles('admin', 'manager')
  @AuditAction({ action: 'stock.composition.accepted', entityType: 'Product' })
  compositionAccept(@Body() dto: StockCompositionAcceptDto, @StockScoped() scope: StockScope | null, @CurrentUser() user?: AuthenticatedUser) {
    return this.stock.compositionAccept(dto, canSeeMoney(user), scope);
  }

  /** Приход / списание / корректировка / бронь / снятие брони. */
  /** «Заказано» и «Поставщики / цены» позиции (ЗП.1, ЗП.5); цены — только деньги-ролям. */
  @AppSection('stock', 'requests')
  @Get('items/:id/ordered')
  @Roles('admin', 'director', 'manager', 'user')
  ordered(@Param('id') id: string, @StockScoped() scope: StockScope | null, @CurrentUser() user?: AuthenticatedUser) {
    return this.stock.itemOrdered(id, canSeeMoney(user), scope);
  }

  /** Обрезок трубы / листа: своя позиция «… — обрезок 1,2 м» + приход; труба — метры уходят из позиции (СМ.2). */
  @Post('items/:id/offcut')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'stock.item.offcut', entityType: 'Material', idParam: 'id', details: (data, p) => ({ materialId: p.id, offcut: (data as { offcut?: { name?: string } })?.offcut?.name }) })
  async offcut(@Param('id') id: string, @Body() dto: StockOffcutDto, @StockScoped() scope: StockScope | null, @CurrentUser() user?: AuthenticatedUser) {
    await this.stock.assertInScope([id], scope);
    return this.stock.offcut(id, dto, user?.id);
  }

  @Post('items/:id/move')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'stock.item.moved', entityType: 'Material', idParam: 'id', details: (data, p) => ({ materialId: p.id, quantity: (data as { quantity?: number })?.quantity }) })
  async move(@Param('id') id: string, @Body() dto: StockMoveDto, @StockScoped() scope: StockScope | null, @CurrentUser() user?: AuthenticatedUser) {
    await this.stock.assertInScope([id], scope);
    return this.stock.move(id, dto, user?.id);
  }

  /** В корзину: только без остатка и брони (иначе 409 с объяснением). */
  @Delete('items/:id')
  @UseGuards(ConfirmTokenGuard)
  @Roles('admin', 'manager')
  @AuditAction({ action: 'stock.item.deleted', entityType: 'Material', idParam: 'id' })
  async remove(@Param('id') id: string, @StockScoped() scope: StockScope | null) {
    await this.stock.assertInScope([id], scope);
    return this.stock.removeItem(id);
  }

  @Post('items/:id/restore')
  @UseGuards(ConfirmTokenGuard)
  @HttpCode(200)
  @Roles('admin', 'manager')
  @AuditAction({ action: 'stock.item.restored', entityType: 'Material', idParam: 'id' })
  async restore(@Param('id') id: string, @StockScoped() scope: StockScope | null) {
    await this.stock.assertInScope([id], scope);
    return this.stock.restoreItem(id);
  }
}
