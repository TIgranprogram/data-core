import { MoneyMaskInterceptor } from '../../common/interceptors/money-mask.interceptor';
import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Res, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import { AppSection } from '../../common/decorators/app-section.decorator';
import { AuditAction } from '../../common/decorators/audit-action.decorator';
import { CurrentUser, type AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CreateOfferDto, OfferCompanyDto, OfferCopiesDto, OfferCopyDto, OfferCreateOrderDto, OfferStatusDto, UpdateBackgroundDto, UpdateOfferDto, UploadBackgroundDto } from './dto';
import { BG_MAX_BYTES, BG_MIME, OfferBackgroundsService } from './offer-backgrounds.service';
import { OffersService } from './offers.service';

/** Коммерческие предложения. Смотреть — все роли с разделом «КП»; создавать, править, менять статус, загружать фоны — admin и manager. */
@ApiTags('КП')
@AppSection('offers')
@UseInterceptors(MoneyMaskInterceptor)
@Controller('offers')
export class OffersController {
  constructor(private readonly offers: OffersService, private readonly bgs: OfferBackgroundsService) {}

  /** `{ items, total, page, limit, counts }`; фильтры `status`, `q`, `sort=-date`. */
  @Get()
  @Roles('admin', 'director', 'manager', 'user')
  list(@Query() q: Record<string, string>) {
    return this.offers.list(q);
  }

  // фоны — до `:id`, иначе «backgrounds» примется за id
  @Get('backgrounds')
  @Roles('admin', 'director', 'manager', 'user')
  backgrounds() {
    return this.bgs.list();
  }

  @Post('backgrounds')
  @Roles('admin', 'manager')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', {
    storage: memoryStorage(),
    limits: { fileSize: BG_MAX_BYTES, files: 1 },
    fileFilter: (_req, file, cb) => cb(null, BG_MIME.test(file.mimetype)),
  }))
  @AuditAction({ action: 'offer.background.created', entityType: 'CommercialOffer' })
  uploadBackground(@UploadedFile() file: { buffer: Buffer; mimetype: string; size: number } | undefined, @Body() dto: UploadBackgroundDto) {
    return this.bgs.upload(file, dto);
  }

  @Patch('backgrounds/:id')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'offer.background.updated', entityType: 'CommercialOffer', idParam: 'id' })
  updateBackground(@Param('id') id: string, @Body() dto: UpdateBackgroundDto) {
    return this.bgs.update(id, dto);
  }

  @Delete('backgrounds/:id')
  @HttpCode(200)
  @Roles('admin', 'manager')
  @AuditAction({ action: 'offer.background.deleted', entityType: 'CommercialOffer' })
  removeBackground(@Param('id') id: string) {
    return this.bgs.remove(id);
  }

  /** Наши фирмы для КП (с «только для КП»): `{ items:[{id,name,offersOnly}], total }`. */
  @Get('companies')
  @Roles('admin', 'director', 'manager', 'user')
  companies() {
    return this.offers.companies();
  }

  @Patch('companies/:id')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'offer.company.offersOnly', entityType: 'Organization', idParam: 'id' })
  setCompany(@Param('id') id: string, @Body() dto: OfferCompanyDto) {
    return this.offers.setCompanyOffersOnly(id, dto.offersOnly);
  }

  /** Стандартные тексты и НДС для новой формы выбранной фирмы. */
  @Get('defaults')
  @Roles('admin', 'director', 'manager', 'user')
  defaults(@Query('companyId') companyId: string) {
    return this.offers.defaults(companyId);
  }

  /** Последнее не отменённое КП заказчику. Нет — null. Объявлено до `:id`. */
  @Get('last')
  @Roles('admin', 'director', 'manager', 'user')
  @ApiQuery({ name: 'customer', required: false, description: 'Точное название, без учёта регистра и лишних пробелов' })
  @ApiQuery({ name: 'counterpartyId', required: false, description: 'Если есть КП с этим контрагентом — оно важнее названия' })
  last(@Query('customer') customer?: string, @Query('counterpartyId') counterpartyId?: string) {
    return this.offers.last({ customer, counterpartyId });
  }

  /** Предпросмотр PDF до сохранения: в базу не пишет, номер не тратит. */
  @Post('preview')
  @HttpCode(200)
  @Roles('admin', 'director', 'manager', 'user')
  async preview(@Body() dto: CreateOfferDto, @Res({ passthrough: true }) res: Response) {
    const r = await this.offers.preview(dto);
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="offer.pdf"; filename*=UTF-8''${encodeURIComponent(r.filename)}` });
    return new StreamableFile(r.buf);
  }

  @Get(':id')
  @Roles('admin', 'director', 'manager', 'user')
  get(@Param('id') id: string) {
    return this.offers.get(id);
  }

  @Post()
  @Roles('admin', 'manager')
  @AuditAction({ action: 'offer.created', entityType: 'CommercialOffer' })
  create(@Body() dto: CreateOfferDto, @CurrentUser() user: AuthenticatedUser) {
    return this.offers.create(dto, user);
  }

  @Patch(':id')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'offer.updated', entityType: 'CommercialOffer', idParam: 'id' })
  update(@Param('id') id: string, @Body() dto: UpdateOfferDto, @CurrentUser() user: AuthenticatedUser) {
    return this.offers.update(id, dto, user);
  }

  /** Черновик заказа из КП (без цен) — для проверки перед созданием. */
  @Post(':id/to-order')
  @HttpCode(200)
  @Roles('admin', 'manager')
  toOrder(@Param('id') id: string) {
    return this.offers.toOrder(id);
  }

  /** Создать договор и позиции из КП; повтор с тем же ключом не дублирует. */
  @Post(':id/create-order')
  @HttpCode(200)
  @Roles('admin', 'manager')
  @AuditAction({ action: 'offer.order.created', entityType: 'CommercialOffer', idParam: 'id' })
  createOrder(@Param('id') id: string, @Body() dto: OfferCreateOrderDto, @CurrentUser() user: AuthenticatedUser) {
    return this.offers.createOrder(id, dto, user);
  }

  /** Копия КП для другой нашей фирмы с наценкой, % — новый черновик. */
  @Post(':id/copy')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'offer.copied', entityType: 'CommercialOffer', idParam: 'id' })
  copy(@Param('id') id: string, @Body() dto: OfferCopyDto, @CurrentUser() user: AuthenticatedUser) {
    return this.offers.copy(id, dto, user);
  }

  /** Несколько копий КП для разных фирм одним действием (C071); общий packId. */
  @Post(':id/copies')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'offer.copied.pack', entityType: 'CommercialOffer', idParam: 'id' })
  copyMany(@Param('id') id: string, @Body() dto: OfferCopiesDto, @CurrentUser() user: AuthenticatedUser) {
    return this.offers.copyMany(id, dto, user);
  }

  /** Мягкое удаление. */
  @Delete(':id')
  @HttpCode(200)
  @Roles('admin', 'manager')
  @AuditAction({ action: 'offer.deleted', entityType: 'CommercialOffer', idParam: 'id' })
  remove(@Param('id') id: string) {
    return this.offers.remove(id);
  }

  /** Вернуть из корзины. */
  @Post(':id/restore')
  @HttpCode(200)
  @Roles('admin', 'manager')
  @AuditAction({ action: 'offer.restored', entityType: 'CommercialOffer', idParam: 'id' })
  restore(@Param('id') id: string) {
    return this.offers.restore(id);
  }

  /** Смена статуса: draft → sent → accepted → paid; rejected / cancelled — из любого, кроме paid. */
  @Post(':id/status')
  @HttpCode(200)
  @Roles('admin', 'manager')
  @AuditAction({ action: 'offer.status', entityType: 'CommercialOffer', idParam: 'id' })
  status(@Param('id') id: string, @Body() dto: OfferStatusDto, @CurrentUser() user: AuthenticatedUser) {
    return this.offers.setStatus(id, dto.status, user, dto.reason);
  }

  @Get(':id/pdf')
  @Roles('admin', 'director', 'manager', 'user')
  async pdf(@Param('id') id: string, @Res({ passthrough: true }) res: Response) {
    const r = await this.offers.pdf(id);
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="offer.pdf"; filename*=UTF-8''${encodeURIComponent(r.filename)}` });
    return new StreamableFile(r.buf);
  }
}
