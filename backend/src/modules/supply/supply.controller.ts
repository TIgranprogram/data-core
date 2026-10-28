import { AppSection, AppSectionFree } from '../../common/decorators/app-section.decorator';
import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Res, UploadedFile, UseInterceptors, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { MoneyMaskInterceptor } from '../../common/interceptors/money-mask.interceptor';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiQuery, ApiTags } from '@nestjs/swagger';
import { AuditAction } from '../../common/decorators/audit-action.decorator';
import { ConfirmTokenGuard } from '../../common/guards/confirm-token.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, type AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { SupplyPhotoDto, SupplyReceiveDto, SupplyRequestDto } from './dto';
import { SupplyService } from './supply.service';
import { SupplierExcelService } from './supplier-excel.service';
import { SupplierCatalogService } from './supplier-catalog.service';
import { CreateInvoicesDto, PatchInvoiceDto, ReceiveInvoiceDto } from './dto-invoice';
import { SupplyInvoiceService } from './supply-invoice.service';
import { CatalogBulkDto, CatalogItemDto, CatalogItemPatchDto } from './dto-catalog';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Заявки снабжения на общей коллекции CRM `supplyrequests`. Роли — как в CRM kppdf. */
@ApiTags('Снабжение')
@UseInterceptors(MoneyMaskInterceptor) // суммы — только админ / директор / бухгалтер
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
  createInvoices(@Body() dto: CreateInvoicesDto, @CurrentUser() user?: AuthenticatedUser) {
    return this.invoices.create(dto.requestIds, user?.id);
  }

  @Get('invoices')
  @Roles('admin', 'director', 'manager', 'user')
  @ApiQuery({ name: 'status', required: false, description: 'через запятую: draft, issued, paid, cancelled' })
  @ApiQuery({ name: 'supplierId', required: false }) @ApiQuery({ name: 'q', required: false, description: '№ счёта или поставщик' })
  @ApiQuery({ name: 'from', required: false }) @ApiQuery({ name: 'to', required: false }) @ApiQuery({ name: 'page', required: false }) @ApiQuery({ name: 'limit', required: false })
  listInvoices(@Query() q: Record<string, string>) {
    return this.invoices.list(q);
  }

  @Get('invoices/:id')
  @Roles('admin', 'director', 'manager', 'user')
  getInvoice(@Param('id') id: string) {
    return this.invoices.get(id);
  }

  @Patch('invoices/:id')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'supply.invoice.updated', entityType: 'SupplyInvoice', idParam: 'id' })
  updateInvoice(@Param('id') id: string, @Body() dto: PatchInvoiceDto, @CurrentUser() user?: AuthenticatedUser) {
    return this.invoices.update(id, dto, user?.id);
  }

  /** Принять счёт на склад: все неполученные заявки (или отмеченные). */
  @Post('invoices/:id/receive')
  @HttpCode(200)
  @Roles('admin', 'manager')
  @AuditAction({ action: 'supply.invoice.received', entityType: 'SupplyInvoice', idParam: 'id' })
  receiveInvoice(@Param('id') id: string, @Body() dto: ReceiveInvoiceDto, @CurrentUser() user?: AuthenticatedUser) {
    return this.invoices.receive(id, dto.requestIds, user?.id);
  }

  /** Оплата — только денежные роли. */
  @Post('invoices/:id/pay')
  @HttpCode(200)
  @Roles('admin', 'director', 'accountant')
  @AuditAction({ action: 'supply.invoice.paid', entityType: 'SupplyInvoice', idParam: 'id' })
  payInvoice(@Param('id') id: string) {
    return this.invoices.pay(id);
  }

  @Delete('invoices/:id')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'supply.invoice.deleted', entityType: 'SupplyInvoice', idParam: 'id' })
  removeInvoice(@Param('id') id: string) {
    return this.invoices.remove(id);
  }

  @AppSection('requests', 'suppliercatalog')
  @Get('supplier-items')
  @Roles('admin', 'director', 'manager', 'user')
  @ApiQuery({ name: 'supplierId', required: false }) @ApiQuery({ name: 'search', required: false }) @ApiQuery({ name: 'page', required: false }) @ApiQuery({ name: 'limit', required: false })
  listSupplierItems(@Query() q: Record<string, string>) {
    return this.excel.listItems(q);
  }

  // ───────── Каталог поставщиков v2: просмотр/экспорт — все роли раздела; правка и импорт — admin, manager ─────────
  @AppSection('requests', 'suppliercatalog')
  @Get('catalog/items')
  @Roles('admin', 'director', 'manager', 'user')
  @ApiQuery({ name: 'supplierId', required: false }) @ApiQuery({ name: 'categoryId', required: false }) @ApiQuery({ name: 'materialId', required: false })
  @ApiQuery({ name: 'search', required: false }) @ApiQuery({ name: 'unmatched', required: false, description: '1 — без связи с материалом' })
  @ApiQuery({ name: 'noPrice', required: false, description: '1 — без цены' }) @ApiQuery({ name: 'stale', required: false, description: '1 — цена старше 180 дней' })
  @ApiQuery({ name: 'page', required: false }) @ApiQuery({ name: 'limit', required: false })
  catalogList(@Query() q: Record<string, string>) {
    return this.catalog.list(q);
  }

  @AppSection('requests', 'suppliercatalog')
  @Get('catalog/counts')
  @Roles('admin', 'director', 'manager', 'user')
  catalogCounts() {
    return this.catalog.counts();
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
  async catalogExport(@Query() q: Record<string, string>, @Res() res: Response) {
    res.setHeader('Content-Type', XLSX);
    res.setHeader('Content-Disposition', "attachment; filename*=UTF-8''" + encodeURIComponent('Каталог поставщиков.xlsx'));
    res.send(await this.catalog.export(q));
  }

  /** multipart: file; supplierId — поставщик по умолчанию (необязателен, если в файле ИНН/название). ?preview=1 — без записи. */
  @AppSection('requests', 'suppliercatalog')
  @Post('catalog/import')
  @HttpCode(200)
  @Roles('admin', 'manager')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 20 * 1024 * 1024 }, storage: undefined }))
  @AuditAction({ action: 'supply.catalog.import', entityType: 'SupplierItem' })
  catalogImport(@UploadedFile() file: Express.Multer.File, @Query('preview') preview: string, @Query('supplierId') qSupplier: string, @Body('supplierId') bSupplier: string, @CurrentUser() user?: AuthenticatedUser) {
    if (!file?.buffer) throw new BadRequestException('Файл не передан');
    const supplierId = qSupplier || bSupplier || undefined;
    return preview === '1' ? this.catalog.preview(file.buffer, supplierId) : this.catalog.apply(file.buffer, supplierId, user?.id);
  }

  @AppSection('requests', 'suppliercatalog')
  @Post('catalog/items')
  @Roles('admin', 'manager')
  catalogCreate(@Body() dto: CatalogItemDto) {
    return this.catalog.bulk([dto]);
  }

  /** Массовая запись (скрипты наполнения): source request|stock|manual, существующие данные Excel не перетираются. */
  @AppSection('requests', 'suppliercatalog')
  @Post('catalog/bulk')
  @HttpCode(200)
  @Roles('admin', 'manager')
  catalogBulk(@Body() dto: CatalogBulkDto) {
    return this.catalog.bulk(dto.items);
  }

  @AppSection('requests', 'suppliercatalog')
  @Patch('catalog/items/:id')
  @Roles('admin', 'manager')
  catalogPatch(@Param('id') id: string, @Body() dto: CatalogItemPatchDto) {
    return this.catalog.patch(id, dto);
  }

  @AppSection('requests', 'suppliercatalog')
  @Delete('catalog/items/:id')
  @Roles('admin', 'manager')
  catalogRemove(@Param('id') id: string) {
    return this.catalog.remove(id);
  }

  @AppSection('requests', 'stock')
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
  list(@Query() q: Record<string, string>) {
    return this.supply.list(q);
  }

  /** «Как называется у поставщика» (МВ.2): найти наши позиции для строк из таблицы поставщика. */
  @AppSection('requests', 'stock')
  @Post('aliases/match')
  @HttpCode(200)
  @Roles('admin', 'director', 'manager', 'user')
  matchAliases(@Body() body: { supplierName?: string; lines?: Array<{ name?: string; article?: string }> }) {
    return this.supply.aliases().match(body?.supplierName, (body?.lines ?? []).slice(0, 500));
  }

  /** Запомнить пары «строка поставщика → наша позиция» (после внесения заявок из таблицы). */
  @AppSection('requests', 'stock')
  @Post('aliases')
  @HttpCode(200)
  @Roles('admin', 'manager')
  rememberAliases(@Body() body: { supplierName?: string; pairs?: Array<{ extName?: string; extArticle?: string; title: string; unit?: string; categoryName?: string; article?: string }> }) {
    return this.supply.aliases().remember(body?.supplierName, (body?.pairs ?? []).slice(0, 500));
  }

  /** Подсказки для формы и фильтров: поставщики, наши компании, категории, «кто подал». */
  @AppSectionFree()
  @Get('lookups')
  @Roles('admin', 'director', 'manager', 'user')
  lookups() {
    return this.supply.lookups();
  }

  @Get('requests/:id')
  @Roles('admin', 'director', 'manager', 'user')
  get(@Param('id') id: string) {
    return this.supply.get(id);
  }

  @AppSection('requests', 'stock')
  @Post('requests')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'supply.request.created', entityType: 'SupplyRequest' })
  create(@Body() dto: SupplyRequestDto, @CurrentUser() user?: AuthenticatedUser) {
    return this.supply.create(dto, user?.id);
  }

  @Patch('requests/:id')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'supply.request.updated', entityType: 'SupplyRequest', idParam: 'id' })
  update(@Param('id') id: string, @Body() dto: SupplyRequestDto, @CurrentUser() user?: AuthenticatedUser) {
    return this.supply.update(id, dto, user?.role, user?.id);
  }

  /** В корзину (мягкое удаление). */
  @Delete('requests/:id')
  @UseGuards(ConfirmTokenGuard)
  @Roles('admin', 'manager')
  @AuditAction({ action: 'supply.request.deleted', entityType: 'SupplyRequest', idParam: 'id' })
  remove(@Param('id') id: string) {
    return this.supply.remove(id);
  }

  /** Вернуть из корзины. */
  @Post('requests/:id/restore')
  @UseGuards(ConfirmTokenGuard)
  @HttpCode(200)
  @Roles('admin', 'manager')
  @AuditAction({ action: 'supply.request.restored', entityType: 'SupplyRequest', idParam: 'id' })
  restore(@Param('id') id: string) {
    return this.supply.restore(id);
  }

  /** Добавить фото: photoId из POST /api/photos/upload (перетаскивание / вставка / файл). */
  @Post('requests/:id/photos')
  @HttpCode(200)
  @Roles('admin', 'manager')
  @AuditAction({ action: 'supply.request.photo.added', entityType: 'SupplyRequest', idParam: 'id' })
  addPhoto(@Param('id') id: string, @Body() dto: SupplyPhotoDto) {
    return this.supply.addPhoto(id, dto.photoId);
  }

  /** Убрать фото из заявки (сам файл остаётся в фотохранилище). */
  @Delete('requests/:id/photos/:photoId')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'supply.request.photo.removed', entityType: 'SupplyRequest', idParam: 'id' })
  removePhoto(@Param('id') id: string, @Param('photoId') photoId: string) {
    return this.supply.removePhoto(id, photoId);
  }

  /** Оприходовать на склад: приход + статус «Получено». */
  @AppSection('requests', 'stock')
  @Post('requests/:id/receive')
  @HttpCode(200)
  @Roles('admin', 'manager')
  @AuditAction({ action: 'supply.request.received', entityType: 'SupplyRequest', idParam: 'id' })
  receive(@Param('id') id: string, @Body() dto: SupplyReceiveDto, @CurrentUser() user?: AuthenticatedUser) {
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
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    if (!file?.buffer) throw new Error('Файл не передан');
    if (preview === '1') return this.excel.preview(file.buffer, id);
    return this.excel.apply(file.buffer, id, user?.id);
  }
}
