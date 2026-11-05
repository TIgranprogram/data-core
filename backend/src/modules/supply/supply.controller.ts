import { AppSection, AppSectionFree } from '../../common/decorators/app-section.decorator';
import { BadRequestException, Body, Controller, ForbiddenException, Delete, Get, HttpCode, Param, Patch, Post, Put, Query, Res, UploadedFile, UseInterceptors, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { MoneyMaskInterceptor } from '../../common/interceptors/money-mask.interceptor';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiQuery, ApiTags } from '@nestjs/swagger';
import { AuditAction } from '../../common/decorators/audit-action.decorator';
import { ConfirmTokenGuard } from '../../common/guards/confirm-token.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { StockScoped } from '../../common/decorators/stock-scoped.decorator';
import type { StockScope } from '../../common/stock-scope';
import { CurrentUser, type AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { SupplyPhotoDto, SupplyReceiveDto, SupplyRequestDto } from './dto';
import { SupplyService } from './supply.service';
import { SupplierExcelService } from './supplier-excel.service';
import { SupplierCatalogService } from './supplier-catalog.service';
import { AddInvoiceRequestsDto, CreateInvoicesDto, MergeInvoicesDto, PatchInvoiceDto, PatchInvoiceLineDto, ReceiveInvoiceDto } from './dto-invoice';
import { isAdminActor } from '../../common/admin-override';
import { SupplyInvoiceService } from './supply-invoice.service';
import { CatalogBulkDto, CatalogItemDto, CatalogItemPatchDto } from './dto-catalog';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Склады (WZ): импорт и массовая запись каталога / прайсов создаёт заявки и позиции по всем категориям — роли с ограничением по складу закрыто. */
const noScoped = (scope: StockScope | null) => {
  if (scope) throw new ForbiddenException('Загрузка прайсов и каталога доступна ролям без ограничения по складу');
};

/** Заявки снабжения на общей коллекции CRM `supplyrequests`. Роли — как в CRM kppdf. */
@ApiTags('Снабжение')
@UseInterceptors(MoneyMaskInterceptor) // суммы — денежным ролям, включая менеджера (common/roles-hierarchy.ts)
@AppSection('requests')
@Controller('supply')
export class SupplyController {
  constructor(
    private readonly supply: SupplyService,
    private readonly excel: SupplierExcelService,
    private readonly catalog: SupplierCatalogService,
    private readonly invoices: SupplyInvoiceService,
  ) {}

// ───────── Счета поставщиков: заявки группой → черновик счёта (по поставщику) → выставлен → оплачен ─────────
  @Post('invoices')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'supply.invoice.created', entityType: 'SupplyInvoice' })
  async createInvoices(@Body() dto: CreateInvoicesDto, @StockScoped() scope: StockScope | null, @CurrentUser() user?: AuthenticatedUser) {
    await this.invoices.assertRequests(dto.requestIds, scope);
    return this.invoices.create(dto.requestIds, user?.id);
  }

  @Get('invoices')
  @Roles('admin', 'director', 'manager', 'user')
  @ApiQuery({ name: 'status', required: false, description: 'через запятую: draft, issued, paid, cancelled' })
  @ApiQuery({ name: 'supplierId', required: false }) @ApiQuery({ name: 'q', required: false, description: '№ счёта или поставщик' })
  @ApiQuery({ name: 'contract', required: false, description: 'none — без договора, has — с договором' })
  @ApiQuery({ name: 'from', required: false }) @ApiQuery({ name: 'to', required: false }) @ApiQuery({ name: 'page', required: false }) @ApiQuery({ name: 'limit', required: false })
  listInvoices(@Query() q: Record<string, string>, @StockScoped() scope: StockScope | null) {
    return this.invoices.list(q, scope);
  }

  @Get('invoices/:id')
  @Roles('admin', 'director', 'manager', 'user')
  getInvoice(@Param('id') id: string, @StockScoped() scope: StockScope | null) {
    return this.invoices.get(id, scope);
  }

  @Patch('invoices/:id')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'supply.invoice.updated', entityType: 'SupplyInvoice', idParam: 'id' })
  async updateInvoice(@Param('id') id: string, @Body() dto: PatchInvoiceDto, @StockScoped() scope: StockScope | null, @CurrentUser() user?: AuthenticatedUser) {
    await this.invoices.assertWhole(id, scope);
    return this.invoices.update(id, dto, user?.id);
  }

  /** Добавить заявки в готовый счёт (группа по одному счёту). */
  @Post('invoices/:id/requests')
  @HttpCode(200)
  @Roles('admin', 'manager')
  @AuditAction({ action: 'supply.invoice.requests_added', entityType: 'SupplyInvoice', idParam: 'id' })
  async addInvoiceRequests(@Param('id') id: string, @Body() dto: AddInvoiceRequestsDto, @StockScoped() scope: StockScope | null, @CurrentUser() user?: AuthenticatedUser) {
    await this.invoices.assertWhole(id, scope);
    await this.invoices.assertRequests(dto.requestIds, scope);
    return this.invoices.addRequests(id, dto.requestIds, dto.reason, user?.id);
  }

  /** Правка цены строки счёта: unitPrice или lineAmount; amount пересчитывается из строк. */
  @Patch('invoices/:id/lines/:lineId')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'supply.invoice.line_updated', entityType: 'SupplyInvoice', idParam: 'id' })
  async updateInvoiceLine(@Param('id') id: string, @Param('lineId') lineId: string, @Body() dto: PatchInvoiceLineDto, @StockScoped() scope: StockScope | null, @CurrentUser() user?: AuthenticatedUser) {
    await this.invoices.assertWhole(id, scope);
    return this.invoices.updateLine(id, lineId, dto, user?.id);
  }

  /** Убрать строку из счёта до приёмки (только админ; заявка остаётся, возвращается в «В заказ»). */
  @Delete('invoices/:id/lines/:lineId')
  @Roles('admin')
  @AuditAction({ action: 'supply.invoice.line_removed', entityType: 'SupplyInvoice', idParam: 'id' })
  async removeInvoiceLine(@Param('id') id: string, @Param('lineId') lineId: string, @StockScoped() scope: StockScope | null, @CurrentUser() user?: AuthenticatedUser) {
    await this.invoices.assertWhole(id, scope);
    return this.invoices.removeLine(id, lineId, user?.id);
  }

  /** Предпросмотр объединения двух счетов: ничего не меняет. */
  @Get('invoices/:id/merge-preview')
  @Roles('admin', 'manager')
  async mergePreview(@Param('id') id: string, @Query('targetId') targetId: string, @StockScoped() scope: StockScope | null) {
    if (!targetId) throw new BadRequestException('Укажите targetId — счёт, с которым объединяем');
    await this.invoices.assertWhole(id, scope);
    await this.invoices.assertWhole(targetId, scope);
    return this.invoices.mergePreview(id, targetId);
  }

  /** Явное объединение двух счетов (append / mergeSameRequest / replaceLines) с журналом и аудитом. */
  @Post('invoices/:id/merge')
  @HttpCode(200)
  @Roles('admin', 'manager')
  @AuditAction({ action: 'supply.invoice.merged', entityType: 'SupplyInvoice', idParam: 'id' })
  async mergeInvoices(@Param('id') id: string, @Body() dto: MergeInvoicesDto, @StockScoped() scope: StockScope | null, @CurrentUser() user?: AuthenticatedUser) {
    await this.invoices.assertWhole(id, scope);
    await this.invoices.assertWhole(dto.targetId, scope);
    return this.invoices.merge(id, dto.targetId, dto.strategy ?? 'append', user?.id);
  }

  /** Принять счёт на склад: все неполученные заявки (или отмеченные). */
  @Post('invoices/:id/receive')
  @HttpCode(200)
  @Roles('admin', 'manager')
  @AuditAction({ action: 'supply.invoice.received', entityType: 'SupplyInvoice', idParam: 'id' })
  async receiveInvoice(@Param('id') id: string, @Body() dto: ReceiveInvoiceDto, @StockScoped() scope: StockScope | null, @CurrentUser() user?: AuthenticatedUser) {
    await this.invoices.assertWhole(id, scope);
    return this.invoices.receive(id, dto.requestIds, user?.id);
  }

  /** Оплата — денежные роли (и менеджер). */
  @Post('invoices/:id/pay')
  @HttpCode(200)
  @Roles('admin', 'director', 'accountant', 'manager')
  @AuditAction({ action: 'supply.invoice.paid', entityType: 'SupplyInvoice', idParam: 'id' })
  async payInvoice(@Param('id') id: string, @StockScoped() scope: StockScope | null, @CurrentUser() user?: AuthenticatedUser) {
    await this.invoices.assertWhole(id, scope);
    return this.invoices.pay(id, user?.id);
  }

  @Delete('invoices/:id')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'supply.invoice.deleted', entityType: 'SupplyInvoice', idParam: 'id' })
  async removeInvoice(@Param('id') id: string, @StockScoped() scope: StockScope | null) {
    await this.invoices.assertWhole(id, scope);
    return this.invoices.remove(id);
  }

  @AppSection('requests', 'suppliercatalog')
  @Get('supplier-items')
  @Roles('admin', 'director', 'manager', 'user')
  @ApiQuery({ name: 'supplierId', required: false }) @ApiQuery({ name: 'search', required: false }) @ApiQuery({ name: 'page', required: false }) @ApiQuery({ name: 'limit', required: false })
  listSupplierItems(@Query() q: Record<string, string>, @StockScoped() scope: StockScope | null) {
    return this.excel.listItems(q, scope);
  }

  // ───────── Каталог поставщиков v2: просмотр/экспорт — все роли раздела; правка и импорт — admin, manager ─────────
  @AppSection('requests', 'suppliercatalog')
  @Get('catalog/items')
  @Roles('admin', 'director', 'manager', 'user')
  @ApiQuery({ name: 'supplierId', required: false }) @ApiQuery({ name: 'categoryId', required: false }) @ApiQuery({ name: 'materialId', required: false })
  @ApiQuery({ name: 'search', required: false }) @ApiQuery({ name: 'unmatched', required: false, description: '1 — без связи с материалом' })
  @ApiQuery({ name: 'noPrice', required: false, description: '1 — без цены' }) @ApiQuery({ name: 'stale', required: false, description: '1 — цена старше 180 дней' })
  @ApiQuery({ name: 'page', required: false }) @ApiQuery({ name: 'limit', required: false })
  catalogList(@Query() q: Record<string, string>, @StockScoped() scope: StockScope | null) {
    return this.catalog.list(q, scope);
  }

  @AppSection('requests', 'suppliercatalog')
  @Get('catalog/items/:id')
  @Roles('admin', 'director', 'manager', 'user')
  catalogItem(@Param('id') id: string, @StockScoped() scope: StockScope | null) {
    return this.catalog.get(id, scope);
  }

  @AppSection('requests', 'suppliercatalog')
  @Get('catalog/counts')
  @Roles('admin', 'director', 'manager', 'user')
  catalogCounts(@StockScoped() scope: StockScope | null) {
    return this.catalog.counts(scope);
  }

  @AppSection('requests', 'suppliercatalog')
  @Get('catalog/template')
  @Roles('admin', 'director', 'manager', 'user')
  async catalogTemplate(@Res() res: Response) {
    res.setHeader('Content-Type', XLSX);
    res.setHeader('Content-Disposition', "attachment; filename*=UTF-8''" + encodeURIComponent('Шаблон каталога поставщика.xlsx'));
    res.send(await this.catalog.template());
  }

  @AppSection('requests', 'suppliercatalog')
  @Get('catalog/export')
  @Roles('admin', 'director', 'manager', 'user')
  async catalogExport(@Query() q: Record<string, string>, @Res() res: Response, @StockScoped() scope: StockScope | null) {
    res.setHeader('Content-Type', XLSX);
    res.setHeader('Content-Disposition', "attachment; filename*=UTF-8''" + encodeURIComponent('Каталог поставщиков.xlsx'));
    res.send(await this.catalog.export(q, scope));
  }

  /** multipart: file; supplierId — поставщик по умолчанию (необязателен, если в файле ИНН/название). ?preview=1 — без записи. */
  @AppSection('requests', 'suppliercatalog')
  @Post('catalog/import')
  @HttpCode(200)
  @Roles('admin', 'manager')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 20 * 1024 * 1024 }, storage: undefined }))
  @AuditAction({ action: 'supply.catalog.import', entityType: 'SupplierItem' })
  catalogImport(@StockScoped() scope: StockScope | null, @UploadedFile() file: Express.Multer.File, @Query('preview') preview: string, @Query('supplierId') qSupplier: string, @Body('supplierId') bSupplier: string, @CurrentUser() user?: AuthenticatedUser) {
    noScoped(scope);
    if (!file?.buffer) throw new BadRequestException('Файл не передан');
    const supplierId = qSupplier || bSupplier || undefined;
    return preview === '1' ? this.catalog.preview(file.buffer, supplierId) : this.catalog.apply(file.buffer, supplierId, user?.id);
  }

  @AppSection('requests', 'suppliercatalog')
  @Post('catalog/items')
  @Roles('admin', 'manager')
  catalogCreate(@Body() dto: CatalogItemDto, @StockScoped() scope: StockScope | null) {
    noScoped(scope);
    return this.catalog.bulk([dto]);
  }

  /** Массовая запись (скрипты наполнения): source request|stock|manual, существующие данные Excel не перетираются. */
  @AppSection('requests', 'suppliercatalog')
  @Post('catalog/bulk')
  @HttpCode(200)
  @Roles('admin', 'manager')
  catalogBulk(@Body() dto: CatalogBulkDto, @StockScoped() scope: StockScope | null) {
    noScoped(scope);
    return this.catalog.bulk(dto.items);
  }

  @AppSection('requests', 'suppliercatalog')
  @Patch('catalog/items/:id')
  @Roles('admin', 'manager')
  async catalogPatch(@Param('id') id: string, @Body() dto: CatalogItemPatchDto, @StockScoped() scope: StockScope | null) {
    await this.catalog.assertItem(id, scope);
    if (scope && dto.materialId !== undefined) noScoped(scope); // смена связи с позицией склада
    return this.catalog.patch(id, dto);
  }

  /** Добавить фото позиции каталога (photoId из POST /api/photos/upload). */
  @AppSection('requests', 'suppliercatalog')
  @Post('catalog/items/:id/photos')
  @HttpCode(200)
  @Roles('admin', 'manager')
  @AuditAction({ action: 'supply.catalog.photo.added', entityType: 'SupplierItem', idParam: 'id' })
  async catalogAddPhoto(@Param('id') id: string, @Body() dto: SupplyPhotoDto, @StockScoped() scope: StockScope | null) {
    await this.catalog.assertItem(id, scope);
    return this.catalog.addPhoto(id, dto.photoId);
  }

  @AppSection('requests', 'suppliercatalog')
  @Put('catalog/items/:id/photos/:photoId/main')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'supply.catalog.photo.main', entityType: 'SupplierItem', idParam: 'id' })
  async catalogMainPhoto(@Param('id') id: string, @Param('photoId') photoId: string, @StockScoped() scope: StockScope | null) {
    await this.catalog.assertItem(id, scope);
    return this.catalog.mainPhoto(id, photoId);
  }

  @AppSection('requests', 'suppliercatalog')
  @Delete('catalog/items/:id/photos/:photoId')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'supply.catalog.photo.removed', entityType: 'SupplierItem', idParam: 'id' })
  async catalogRemovePhoto(@Param('id') id: string, @Param('photoId') photoId: string, @StockScoped() scope: StockScope | null) {
    await this.catalog.assertItem(id, scope);
    return this.catalog.removePhoto(id, photoId);
  }

  @AppSection('requests', 'suppliercatalog')
  @Delete('catalog/items/:id')
  @Roles('admin', 'manager')
  async catalogRemove(@Param('id') id: string, @StockScoped() scope: StockScope | null) {
    await this.catalog.assertItem(id, scope);
    return this.catalog.remove(id);
  }

  // Список: заявки, остатки и телефонный склад (stock-mobile.js: received / ordered,paid). Метод перекрывает класс.
  @AppSection('requests', 'stock', 'stock-mobile')
  @Get('requests')
  @Roles('admin', 'director', 'manager', 'user')
  @ApiQuery({ name: 'page', required: false }) @ApiQuery({ name: 'limit', required: false, description: '≤1000, по умолчанию 1000' })
  @ApiQuery({ name: 'search', required: false, description: 'наименование, артикул, заказчик, примечание, кто подал, № счёта, № заявки, поставщик' })
  @ApiQuery({ name: 'sort', required: false, description: 'num | requestDate | title | qty | priceHint | status | requestedBy | createdAt | updatedAt | deletedAt; «-» — по убыванию (умолч. -requestDate)' })
  @ApiQuery({ name: 'status', required: false, description: 'через запятую: in_progress, requested, ordered, paid, received, cancelled' })
  @ApiQuery({ name: 'supplierId', required: false }) @ApiQuery({ name: 'categoryId', required: false }) @ApiQuery({ name: 'materialId', required: false })
  @ApiQuery({ name: 'requestedBy', required: false }) @ApiQuery({ name: 'priority', required: false })
  @ApiQuery({ name: 'from', required: false, description: 'ГГГГ-ММ-ДД' }) @ApiQuery({ name: 'to', required: false, description: 'ГГГГ-ММ-ДД' })
  @ApiQuery({ name: 'deleted', required: false, description: '1 — только удалённые (корзина)' })
  list(@Query() q: Record<string, string>, @StockScoped() scope: StockScope | null) {
    return this.supply.list(q, scope);
  }

  /** «Как называется у поставщика» (МВ.2): найти наши позиции для строк из таблицы поставщика. */
  @AppSection('requests', 'stock')
  @Post('aliases/match')
  @HttpCode(200)
  @Roles('admin', 'director', 'manager', 'user')
  matchAliases(@Body() body: { supplierName?: string; lines?: Array<{ name?: string; article?: string }> }, @StockScoped() scope: StockScope | null) {
    noScoped(scope); // подбор по всем позициям склада
    return this.supply.aliases().match(body?.supplierName, (body?.lines ?? []).slice(0, 500));
  }

  /** Запомнить пары «строка поставщика → наша позиция» (после внесения заявок из таблицы). */
  @AppSection('requests', 'stock')
  @Post('aliases')
  @HttpCode(200)
  @Roles('admin', 'manager')
  rememberAliases(@Body() body: { supplierName?: string; pairs?: Array<{ extName?: string; extArticle?: string; title: string; unit?: string; categoryName?: string; article?: string }> }, @StockScoped() scope: StockScope | null) {
    noScoped(scope);
    return this.supply.aliases().remember(body?.supplierName, (body?.pairs ?? []).slice(0, 500));
  }

  /** Подсказки для формы и фильтров: поставщики, наши компании, категории, «кто подал». */
  @AppSectionFree()
  @Get('lookups')
  @Roles('admin', 'director', 'manager', 'user')
  lookups(@StockScoped() scope: StockScope | null) {
    return this.supply.lookups(scope);
  }

  /** Подсказка «уже заказывали» для формы: одна строка на название, без фото и лишних полей. */
  @AppSection('requests', 'stock')
  @Get('requests/lookup')
  @Roles('admin', 'director', 'manager', 'user')
  @ApiQuery({ name: 'search', required: false }) @ApiQuery({ name: 'limit', required: false, description: '≤500, по умолчанию 50' })
  lookup(@Query() q: Record<string, string>, @StockScoped() scope: StockScope | null) {
    return this.supply.lookup(q, scope);
  }

  @Get('requests/:id')
  @Roles('admin', 'director', 'manager', 'user')
  get(@Param('id') id: string, @StockScoped() scope: StockScope | null) {
    return this.supply.get(id, scope);
  }

  @Post('requests')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'supply.request.created', entityType: 'SupplyRequest' })
  async create(@Body() dto: SupplyRequestDto, @StockScoped() scope: StockScope | null, @CurrentUser() user?: AuthenticatedUser) {
    await this.supply.assertNew(dto, scope);
    return this.supply.create(dto, user?.id);
  }

  @Patch('requests/:id')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'supply.request.updated', entityType: 'SupplyRequest', idParam: 'id' })
  async update(@Param('id') id: string, @Body() dto: SupplyRequestDto, @StockScoped() scope: StockScope | null, @CurrentUser() user?: AuthenticatedUser) {
    await this.supply.assertRequest(id, scope);
    if (dto.materialId || dto.categoryId || dto.categoryName) await this.supply.assertNew(dto, scope);
    const actor = { id: user?.id, role: user?.role, isOwner: user?.isOwner, username: user?.username };
    let body = dto;
    // ЗЯ-1 п.3: сумма и количество строки счёта у администратора идут в правку строки счёта (пересчёт amount, журнал)
    if (isAdminActor(actor) && (dto.priceHint !== undefined || dto.qty !== undefined) && (await this.invoices.adminEditLine(id, dto, actor))) {
      const { priceHint: _p, qty: _q, ...rest } = dto; // eslint-disable-line @typescript-eslint/no-unused-vars
      body = rest;
      if (!Object.keys(rest).some((k) => k !== 'reason')) return this.supply.get(id);
    }
    return this.supply.update(id, body, user?.role, user?.id, actor);
  }

  /** В корзину (мягкое удаление). */
  @Delete('requests/:id')
  @UseGuards(ConfirmTokenGuard)
  @Roles('admin', 'manager')
  @AuditAction({ action: 'supply.request.deleted', entityType: 'SupplyRequest', idParam: 'id' })
  async remove(@Param('id') id: string, @StockScoped() scope: StockScope | null) {
    await this.supply.assertRequest(id, scope);
    return this.supply.remove(id);
  }

  /** Вернуть из корзины. */
  @Post('requests/:id/restore')
  @UseGuards(ConfirmTokenGuard)
  @HttpCode(200)
  @Roles('admin', 'manager')
  @AuditAction({ action: 'supply.request.restored', entityType: 'SupplyRequest', idParam: 'id' })
  async restore(@Param('id') id: string, @StockScoped() scope: StockScope | null) {
    await this.supply.assertRequest(id, scope);
    return this.supply.restore(id);
  }

  /** Добавить фото: photoId из POST /api/photos/upload (перетаскивание / вставка / файл). */
  @Post('requests/:id/photos')
  @HttpCode(200)
  @Roles('admin', 'manager')
  @AuditAction({ action: 'supply.request.photo.added', entityType: 'SupplyRequest', idParam: 'id' })
  async addPhoto(@Param('id') id: string, @Body() dto: SupplyPhotoDto, @StockScoped() scope: StockScope | null) {
    await this.supply.assertRequest(id, scope);
    return this.supply.addPhoto(id, dto.photoId);
  }

  @Put('requests/:id/photos/:photoId/main')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'supply.request.photo.main', entityType: 'SupplyRequest', idParam: 'id' })
  async mainPhoto(@Param('id') id: string, @Param('photoId') photoId: string, @StockScoped() scope: StockScope | null) {
    await this.supply.assertRequest(id, scope);
    return this.supply.mainPhoto(id, photoId);
  }

  /** Убрать фото из заявки (сам файл остаётся в фотохранилище). */
  @Delete('requests/:id/photos/:photoId')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'supply.request.photo.removed', entityType: 'SupplyRequest', idParam: 'id' })
  async removePhoto(@Param('id') id: string, @Param('photoId') photoId: string, @StockScoped() scope: StockScope | null) {
    await this.supply.assertRequest(id, scope);
    return this.supply.removePhoto(id, photoId);
  }

  /** Оприходовать на склад: приход + статус «Получено». Телефонный склад — тоже; создать заявку он не может. */
  @AppSection('requests', 'stock', 'stock-mobile')
  @Post('requests/:id/receive')
  @HttpCode(200)
  @Roles('admin', 'manager', 'user')
  @AuditAction({ action: 'supply.request.received', entityType: 'SupplyRequest', idParam: 'id' })
  async receive(@Param('id') id: string, @Body() dto: SupplyReceiveDto, @StockScoped() scope: StockScope | null, @CurrentUser() user?: AuthenticatedUser) {
    await this.supply.assertRequest(id, scope);
    return this.supply.receive(id, dto, user?.id);
  }

  /**
   * СКЕ-2: загрузить Excel-прайс поставщика.
   * ?preview=1 → разбор без сохранения (предпросмотр строк).
   * Без preview → создать заявки + upsert supplieritems.
   */
  @Post('suppliers/:id/excel')
  @HttpCode(200)
  @Roles('admin', 'manager')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 20 * 1024 * 1024 }, storage: undefined }))
  async importExcel(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Query('preview') preview: string,
    @StockScoped() scope: StockScope | null,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    noScoped(scope);
    if (!file?.buffer) throw new Error('Файл не передан');
    if (preview === '1') return this.excel.preview(file.buffer, id);
    return this.excel.apply(file.buffer, id, user?.id);
  }
}
