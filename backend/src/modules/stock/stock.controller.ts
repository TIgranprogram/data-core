import { Throttle } from '@nestjs/throttler';
import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiQuery, ApiTags } from '@nestjs/swagger';
import { AuditAction } from '../../common/decorators/audit-action.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, type AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { StockBatchDto, StockIssueDto, StockItemDto, StockOffcutDto, StockMoveDto, StockPhotoDto, StockReserveListDto } from './dto';
import { StockService } from './stock.service';

/**
 * Склад на общих коллекциях CRM (materials + storageitems + stockmovements + reservations).
 * Роли — как в CRM kppdf: читать могут все, менять — admin и manager.
 */
@ApiTags('Склад')
@Controller('stock')
export class StockController {
  constructor(private readonly stock: StockService) {}

  @Get('warehouses')
  @Roles('admin', 'director', 'manager', 'user')
  warehouses() {
    return this.stock.listWarehouses();
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
  list(@Query() q: Record<string, string>) {
    return this.stock.listItems(q);
  }

  /** Сводка по категориям: позиций всего / к закупке / нет на складе. */
  @Get('categories')
  @Roles('admin', 'director', 'manager', 'user')
  categories() {
    return this.stock.categorySummary();
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
  movements(@Query() q: Record<string, string>) {
    return this.stock.listMovements(q);
  }

  /** Отменить движение: проводится обратное, исходное помечается отменённым. */
  @Post('movements/:id/cancel')
  @HttpCode(200)
  @Roles('admin', 'manager')
  @AuditAction({ action: 'stock.movement.cancelled', entityType: 'StockMovement', idParam: 'id' })
  cancelMovement(@Param('id') id: string, @CurrentUser() user?: AuthenticatedUser) {
    return this.stock.cancelMovement(id, user?.id);
  }

  @Get('items/:id')
  @Roles('admin', 'director', 'manager', 'user')
  get(@Param('id') id: string) {
    return this.stock.getItem(id);
  }

  @Get('items/:id/history')
  @Roles('admin', 'director', 'manager', 'user')
  @ApiQuery({ name: 'limit', required: false, description: 'только последние N записей (1–200); total — всего записей' })
  history(@Param('id') id: string, @Query('limit') limit?: string) {
    return this.stock.history(id, limit ? Number(limit) : undefined);
  }

  /** Новая позиция (материал + строка остатка). Такое же наименование — вернётся существующая. */
  @Post('items')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'stock.item.created', entityType: 'Material' })
  create(@Body() dto: StockItemDto) {
    return this.stock.createItem(dto);
  }

  @Patch('items/:id')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'stock.item.updated', entityType: 'Material', idParam: 'id' })
  update(@Param('id') id: string, @Body() dto: StockItemDto) {
    return this.stock.updateItem(id, dto);
  }

  @Post('items/:id/photos')
  @Roles('admin', 'manager')
  photo(@Param('id') id: string, @Body() dto: StockPhotoDto) {
    return this.stock.addPhoto(id, dto.photoId);
  }

  /** Убрать фото позиции (главное — следующее по списку). */
  @Delete('items/:id/photos/:photoId')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'stock.item.photo.removed', entityType: 'Material', idParam: 'id' })
  removePhoto(@Param('id') id: string, @Param('photoId') photoId: string) {
    return this.stock.removePhoto(id, photoId);
  }

  /** Бронь по списку (спецификация): бронирует сколько свободно, нехватку возвращает в short. */
  @Post('reserve-list')
  @Roles('admin', 'manager')
  @Throttle({ short: { ttl: 60_000, limit: 30 } }) // М8: массовая операция — не чаще 30 в минуту
  @AuditAction({ action: 'stock.reserve.list', entityType: 'StockMovement' })
  reserveList(@Body() dto: StockReserveListDto, @CurrentUser() user?: AuthenticatedUser) {
    return this.stock.reserveList(dto, user?.id);
  }

  /** Активные брони по названиям. */
  @Get('reservations')
  @Roles('admin', 'director', 'manager', 'user')
  reservations() {
    return this.stock.listReservations();
  }

  /** Карточка брони: что забронировано, сколько выдано и кому, под какой заказ, заявки на недостающее. key — batchId или id брони. */
  @Get('reservations/group/:key')
  @Roles('admin', 'director', 'manager', 'user')
  reservationDetail(@Param('key') key: string) {
    return this.stock.reservationDetail(key);
  }

  /** «Выдать по брони»: списание по броням (целиком или частично), кому выдано. */
  @Post('reservations/issue')
  @HttpCode(200)
  @Roles('admin', 'manager')
  @AuditAction({ action: 'stock.reserve.issued', entityType: 'StockMovement' })
  issueReservations(@Body() dto: StockIssueDto, @CurrentUser() user?: AuthenticatedUser) {
    return this.stock.issueReservations(dto, user?.id);
  }

  @Post('reservations/:id/release')
  @HttpCode(200)
  @Roles('admin', 'manager')
  @AuditAction({ action: 'stock.reserve.released', entityType: 'StockMovement' })
  releaseReservation(@Param('id') id: string) {
    return this.stock.releaseReservation(id);
  }

  @Post('reservations/group/:batchId/release')
  @HttpCode(200)
  @Roles('admin', 'manager')
  @AuditAction({ action: 'stock.reserve.group.released', entityType: 'StockMovement' })
  releaseGroup(@Param('batchId') batchId: string) {
    return this.stock.releaseGroup(batchId);
  }

  /** Пакет: списать / принять / пересчитать несколько позиций одной операцией (всё или ничего). */
  @Post('batch')
  @Roles('admin', 'manager')
  @Throttle({ short: { ttl: 60_000, limit: 30 } }) // М8: массовая операция — не чаще 30 в минуту
  @AuditAction({ action: 'stock.batch', entityType: 'StockMovement' })
  batch(@Body() dto: StockBatchDto, @CurrentUser() user?: AuthenticatedUser) {
    return this.stock.batch(dto, user?.id);
  }

  /** Отменить пакет целиком (обратные движения; история не стирается). */
  @Post('batch/:batchId/cancel')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'stock.batch.cancelled', entityType: 'StockMovement' })
  cancelBatch(@Param('batchId') batchId: string, @CurrentUser() user?: AuthenticatedUser) {
    return this.stock.cancelBatch(batchId, user?.id);
  }

  /** Приход / списание / корректировка / бронь / снятие брони. */
  /** «Заказано» и «Поставщики / цены» позиции (ЗП.1, ЗП.5); цены — только деньги-ролям. */
  @Get('items/:id/ordered')
  @Roles('admin', 'director', 'manager', 'user')
  ordered(@Param('id') id: string, @CurrentUser() user?: AuthenticatedUser) {
    const money = user?.isOwner === true || ['admin', 'director', 'accountant'].includes(user?.role ?? '');
    return this.stock.itemOrdered(id, money);
  }

  /** Обрезок трубы / листа: своя позиция «… — обрезок 1,2 м» + приход; труба — метры уходят из позиции (СМ.2). */
  @Post('items/:id/offcut')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'stock.item.offcut', entityType: 'Material', idParam: 'id', details: (data, p) => ({ materialId: p.id, offcut: (data as { offcut?: { name?: string } })?.offcut?.name }) })
  offcut(@Param('id') id: string, @Body() dto: StockOffcutDto, @CurrentUser() user?: AuthenticatedUser) {
    return this.stock.offcut(id, dto, user?.id);
  }

  @Post('items/:id/move')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'stock.item.moved', entityType: 'Material', idParam: 'id', details: (data, p) => ({ materialId: p.id, quantity: (data as { quantity?: number })?.quantity }) })
  move(@Param('id') id: string, @Body() dto: StockMoveDto, @CurrentUser() user?: AuthenticatedUser) {
    return this.stock.move(id, dto, user?.id);
  }

  /** В корзину: только без остатка и брони (иначе 409 с объяснением). */
  @Delete('items/:id')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'stock.item.deleted', entityType: 'Material', idParam: 'id' })
  remove(@Param('id') id: string) {
    return this.stock.removeItem(id);
  }

  @Post('items/:id/restore')
  @HttpCode(200)
  @Roles('admin', 'manager')
  @AuditAction({ action: 'stock.item.restored', entityType: 'Material', idParam: 'id' })
  restore(@Param('id') id: string) {
    return this.stock.restoreItem(id);
  }
}
