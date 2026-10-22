import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query, Res, StreamableFile } from '@nestjs/common';
import { ApiQuery, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuditAction } from '../../common/decorators/audit-action.decorator';
import { CurrentUser, type AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { ProductPassportService } from './product-passport.service';
import { PassportPdfService } from './passport-pdf.service';
import { CreateProductPassportDto } from './dto/create-product-passport.dto';
import { UpdateProductPassportDto } from './dto/update-product-passport.dto';
import type { PassportTemplateContent } from './passport-template.default';

const VIEW = ['admin', 'director', 'manager'] as const;
const EDIT = ['admin', 'director'] as const;
const attachment = (name: string) => `attachment; filename="passport.${name.endsWith('.zip') ? 'zip' : 'pdf'}"; filename*=UTF-8''${encodeURIComponent(name)}`;

/**
 * Паспорта изделий (TASKS ПС): паспорт = экземпляр (номер, талон, номер изделия, дата, заказчик), модель — отдельно.
 * Смотреть — менеджер и выше; создавать и менять — директор и админ. Номера выдаёт сервер.
 */
@ApiTags('Паспорта изделий')
@Controller()
export class ProductPassportController {
  constructor(private readonly service: ProductPassportService, private readonly pdfs: PassportPdfService) {}

  /** Совместимость с kppdf: последний паспорт изделия-модели. */
  @Get('products/:productId/passport')
  @Roles(...VIEW)
  findByProduct(@Param('productId') productId: string) {
    return this.service.findByProductId(productId);
  }

  @Post('products/:productId/passport')
  @Roles(...EDIT)
  @AuditAction({ action: 'create', entityType: 'ProductPassport' })
  createForProduct(@Param('productId') productId: string, @Body() dto: CreateProductPassportDto) {
    return this.service.create({ ...dto, productId });
  }

  @Get('passports')
  @Roles(...VIEW)
  @ApiQuery({ name: 'search', required: false, description: '№ паспорта, талон, номер изделия, наименование, артикул, заказчик, объект, № заказа' })
  @ApiQuery({ name: 'year', required: false }) @ApiQuery({ name: 'month', required: false, description: '1–12, вместе с year' })
  @ApiQuery({ name: 'category', required: false }) @ApiQuery({ name: 'supplierOrgId', required: false }) @ApiQuery({ name: 'customer', required: false })
  @ApiQuery({ name: 'noImages', required: false, description: '1 — без картинок' }) @ApiQuery({ name: 'incomplete', required: false, description: '1 — не хватает данных для выдачи' })
  @ApiQuery({ name: 'productId', required: false }) @ApiQuery({ name: 'deleted', required: false, description: '1 — корзина' })
  @ApiQuery({ name: 'sort', required: false, description: 'passportNo | date | name | category | customerName | createdAt | updatedAt; «-» — по убыванию (умолч. -passportNo)' })
  @ApiQuery({ name: 'page', required: false }) @ApiQuery({ name: 'limit', required: false })
  list(@Query() q: Record<string, string>) {
    return this.service.list(q);
  }

  /** Значения для фильтров: годы, категории, поставщики, заказчики. */
  @Get('passports/facets')
  @Roles(...VIEW)
  facets() {
    return this.service.facets();
  }

  /** Готовые тексты для «Описания»: материалы, установка, назначение — варианты с категориями (ПС.5). */
  @Get('passports/phrases')
  @Roles(...VIEW)
  phrases() {
    return this.service.phrases();
  }

  /** Модели (артикул + наименование) с фото и полями — выбор модели при создании паспорта. */
  @Get('passports/models')
  @Roles(...VIEW)
  models() {
    return this.service.models();
  }

  /** «Шаблон паспорта» — типовые разделы 3–7 и таблицы (действующая версия). */
  @Get('passports/template')
  @Roles(...VIEW)
  @ApiQuery({ name: 'category', required: false, enum: ['ALL', 'DIO', 'DSP', 'TRN', 'WRK', 'MAF'], description: 'Категория блока текста; нет версии категории — «Для всех»' })
  template(@Query('category') category?: string) {
    return this.service.template(category);
  }

  @Put('passports/template')
  @Roles(...EDIT)
  @AuditAction({ action: 'passport.template.updated', entityType: 'PassportTemplate' })
  saveTemplate(@Body() body: Partial<PassportTemplateContent> & { category?: string }, @CurrentUser() user?: AuthenticatedUser) {
    return this.service.saveTemplate(body, user?.id);
  }

  /** Пакет PDF по фильтру списка (до 200): ?stamp=1 — с печатью и подписью; ?mode=print — 2 стр. на A4. */
  @Get('passports/zip')
  @Roles(...EDIT)
  async zip(@Query() q: Record<string, string>, @Res({ passthrough: true }) res: Response) {
    const buf = await this.pdfs.zip(q, { stamp: q.stamp === '1', mode: q.mode === 'print' ? 'print' : 'pages' });
    res.set({ 'Content-Type': 'application/zip', 'Content-Disposition': attachment(`Паспорта_${new Date().toISOString().slice(0, 10)}.zip`) });
    return new StreamableFile(buf);
  }

  @Get('passports/:id')
  @Roles(...VIEW)
  findOne(@Param('id') id: string) {
    return this.service.get(id);
  }

  /**
   * PDF паспорта: ?stamp=1 — с печатью и подписью организации-поставщика; ?mode=print — буклет 2 стр. на A4 альбомный;
   * ?mode=stand — лист «Правила пользования» для стенда, A3 книжный (только паспорт v2 при флаге passports.v2, иначе 400).
   */
  @Get('passports/:id/pdf')
  @Roles(...EDIT)
  @ApiQuery({ name: 'stamp', required: false, description: '1 — с печатью и подписью' })
  @ApiQuery({ name: 'mode', required: false, enum: ['pages', 'print', 'stand'], description: 'pages — A5 постранично (умолч.); print — буклет на A4; stand — лист для стенда A3 (только v2)' })
  async pdf(@Param('id') id: string, @Query('stamp') stamp: string, @Query('mode') mode: string, @Res({ passthrough: true }) res: Response) {
    const r = mode === 'stand' ? await this.pdfs.stand(id) : await this.pdfs.pdf(id, { stamp: stamp === '1', mode: mode === 'print' ? 'print' : 'pages' });
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': attachment(r.filename) });
    return new StreamableFile(r.buf);
  }

  @Post('passports')
  @Roles(...EDIT)
  @AuditAction({ action: 'passport.created', entityType: 'ProductPassport' })
  create(@Body() dto: CreateProductPassportDto) {
    return this.service.create(dto);
  }

  /** v2: пересобрать текст паспорта по справочникам и шаблону категории (снимок `textSnapshot`). Паспорт без категории — 400. */
  /** v2: правка пункта текста только для этого паспорта { sectionKey, itemKey, text } (справочники не меняются). */
  @Patch('passports/:id/snapshot-item')
  @Roles(...EDIT)
  @AuditAction({ action: 'passport.updated', entityType: 'ProductPassport', idParam: 'id', details: () => ({ meta: { snapshotItem: true } }) })
  editSnapshotItem(@Param('id') id: string, @Body() b: { sectionKey?: string; itemKey?: string; text?: string }) {
    return this.service.editSnapshotItem(id, b ?? {});
  }

  /** v2: перенести текст пункта из этого паспорта в версию шаблона его категории { sectionKey, itemKey }. */
  @Post('passports/:id/snapshot-item/promote')
  @HttpCode(200)
  @Roles(...EDIT)
  @AuditAction({ action: 'passport.template.updated', entityType: 'PassportTemplate' })
  promoteSnapshotItem(@Param('id') id: string, @Body() b: { sectionKey?: string; itemKey?: string }, @CurrentUser() user?: AuthenticatedUser) {
    return this.service.promoteSnapshotItem(id, b ?? {}, user?.id);
  }

  @Post('passports/:id/snapshot')
  @HttpCode(200)
  @Roles(...EDIT)
  @AuditAction({ action: 'passport.updated', entityType: 'ProductPassport', idParam: 'id', details: () => ({ meta: { snapshot: true } }) })
  async snapshot(@Param('id') id: string) {
    const r = await this.service.snapshot(id);
    if (!r) throw new BadRequestException('У паспорта не выбрана категория (паспорт v1) — снимок текста не нужен');
    return r;
  }

  /** Копия на ту же модель: новые номера, дата — сегодня, заказчик — пустой. */
  @Post('passports/:id/copy')
  @Roles(...EDIT)
  @AuditAction({ action: 'passport.copied', entityType: 'ProductPassport', idParam: 'id' })
  copy(@Param('id') id: string, @Body() dto: CreateProductPassportDto) {
    return this.service.copy(id, dto);
  }

  @Patch('passports/:id')
  @Roles(...EDIT)
  @AuditAction({ action: 'passport.updated', entityType: 'ProductPassport', idParam: 'id' })
  update(@Param('id') id: string, @Body() dto: UpdateProductPassportDto) {
    return this.service.update(id, dto);
  }

  @Delete('passports/:id')
  @Roles(...EDIT)
  @AuditAction({ action: 'passport.deleted', entityType: 'ProductPassport', idParam: 'id' })
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }

  @Post('passports/:id/restore')
  @HttpCode(200)
  @Roles(...EDIT)
  @AuditAction({ action: 'passport.restored', entityType: 'ProductPassport', idParam: 'id' })
  restore(@Param('id') id: string) {
    return this.service.restore(id);
  }
}
