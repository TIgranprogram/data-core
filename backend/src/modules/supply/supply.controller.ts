import { AppSection, AppSectionFree } from '../../common/decorators/app-section.decorator';
import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UploadedFile, UseInterceptors, UseGuards } from '@nestjs/common';
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

/** Заявки снабжения на общей коллекции CRM `supplyrequests`. Роли — как в CRM kppdf. */
@ApiTags('Снабжение')
@UseInterceptors(MoneyMaskInterceptor) // суммы — только админ / директор / бухгалтер
@AppSection('requests')
@Controller('supply')
export class SupplyController {
  constructor(
    private readonly supply: SupplyService,
    private readonly excel: SupplierExcelService,
  ) {}

  @AppSection('requests', 'suppliercatalog')
  @Get('supplier-items')
  @Roles('admin', 'director', 'manager', 'user')
  @ApiQuery({ name: 'supplierId', required: false }) @ApiQuery({ name: 'search', required: false }) @ApiQuery({ name: 'page', required: false }) @ApiQuery({ name: 'limit', required: false })
  listSupplierItems(@Query() q: Record<string, string>) {
    return this.excel.listItems(q);
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
    return this.supply.update(id, dto, user?.role);
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
