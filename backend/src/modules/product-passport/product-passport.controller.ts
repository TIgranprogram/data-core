import { AppSection } from '../../common/decorators/app-section.decorator';
import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query, Res, StreamableFile } from '@nestjs/common';
import { ApiQuery, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuditAction } from '../../common/decorators/audit-action.decorator';
import { CurrentUser, type AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { ProductPassportService } from './product-passport.service';
import { PassportPdfService } from './passport-pdf.service';
import { CreateProductPassportDto } from './dto/create-product-passport.dto';
import { NextPassportNumberDto } from './dto/next-number.dto';
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
@AppSection('passports')
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
  async createForProduct(@Param('productId') productId: string, @Body() dto: CreateProductPassportDto) {
    // совместимость с CRM kppdf: паспорт для неё — сразу с номером (черновиков CRM не знает)
    const doc = await this.service.create({ ...dto, productId });
    if (doc.status !== 'draft') return doc;
    // не хватило полей для выпуска — черновик не оставляем (проверка архитектора 2026-10-23)
    try { return await this.service.issue(String(doc._id)); } catch (e) { await this.service.discardDraft(String(doc._id)); throw e; }
  }

  /** НМ-2: дубли перед созданием — ?productId&orderNo&customer&objectName&exceptId → { items } (черновики изделия и выпущенные на тот же заказ / покупателя / адрес). */
  @Get('passports/duplicates')
  @Roles(...VIEW)
  duplicates(@Query() q: Record<string, string>) {
    return this.service.duplicates(q);
  }

  /** Очередь «Нужно сделать»: позиции с готовым проектированием и без выпущенного паспорта, по сроку отгрузки. Без денег. */
  @Get('passports/queue')
  @Roles(...VIEW)
  @ApiQuery({ name: 'due', required: false, description: 'overdue | soon | all (умолч.)' }) @ApiQuery({ name: 'search', required: false }) @ApiQuery({ name: 'limit', required: false })
  queue(@Query() q: Record<string, string>) {
    return this.service.queue(q);
  }

  /** ПН: следующие номера (паспорт, талон, изделие) — только показ, ничего не занимает. */
  @Get('passports/next-numbers')
  @Roles(...EDIT)
  nextNumbers() {
    return this.service.nextNumbers();
  }

  /** ПН: задать № следующего выпущенного паспорта (409, если он уже занят). */
  @Put('passports/next-number')
  @Roles(...EDIT)
  @AuditAction({ action: 'passport.nextNumber', entityType: 'ProductPassport' })
  setNextNumber(@Body() dto: NextPassportNumberDto) {
    return this.service.setNextNumber(dto);
  }

  @Get('passports')
  @Roles(...VIEW)
  @ApiQuery({ name: 'search', required: false, description: '№ паспорта, талон, номер изделия, наименование, артикул, заказчик, объект, № заказа' })
  @ApiQuery({ name: 'year', required: false }) @ApiQuery({ name: 'month', required: false, description: '1–12, вместе с year' })
  @ApiQuery({ name: 'category', required: false }) @ApiQuery({ name: 'supplierOrgId', required: false }) @ApiQuery({ name: 'customer', required: false })
  @ApiQuery({ name: 'noImages', required: false, description: '1 — без картинок' }) @ApiQuery({ name: 'incomplete', required: false, description: '1 — не хватает данных для выдачи' })
  @ApiQuery({ name: 'salesOrderId', required: false }) @ApiQuery({ name: 'orderNo', required: false }) @ApiQuery({ name: 'readiness', required: false, description: 'ready | notReady | rework' })
  @ApiQuery({ name: 'productId', required: false }) @ApiQuery({ name: 'deleted', required: false, description: '1 — корзина' })
  @ApiQuery({ name: 'legacy', required: false, description: '1 — только старые (перенос: source не app)' })
  @ApiQuery({ name: 'sort', required: false, description: 'passportNo | date | name | category | customerName | createdAt | updatedAt; «-» — по убыванию (умолч. -passportNo)' })
  @ApiQuery({ name: 'page', required: false }) @ApiQuery({ name: 'limit', required: false })
  list(@Query() q: Record<string, string>) {
    return this.service.list(q);
  }

  /** Заказ → паспорта: группы { orderId, orderNo, customerName, total, ready, notReady, rework, items[] }, пагинация по заказам; «Без заказа» — последней. */
  @Get('passports/by-order')
  @Roles(...VIEW)
  @ApiQuery({ name: 'readiness', required: false, description: 'ready | notReady | rework' })
  @ApiQuery({ name: 'search', required: false }) @ApiQuery({ name: 'page', required: false }) @ApiQuery({ name: 'limit', required: false })
  byOrder(@Query() q: Record<string, string>) {
    return this.service.byOrder(q);
  }

  /** Значения для фильтров: годы, категории, поставщики, заказчики. */
  @Get('passports/facets')
  @Roles(...VIEW)
  facets(@Query() q: Record<string, unknown>) {
    // Б2: те же параметры, что у списка (category, year, month, supplierOrgId, customer, status, legacy) — числа при уже выбранном
    return this.service.facets(q);
  }

  /** Готовые тексты для «Описания»: материалы, установка, назначение — варианты с категориями (ПС.5). */
  @AppSection('passports', 'products')
  @Get('passports/phrases')
  @Roles(...VIEW)
  phrases() {
    return this.service.phrases();
  }

  /** Воронка текстов (ПВ): дерево «раздел → варианты → подварианты → текст», видимое категории (?category=TRN; без неё — всё). */
  @AppSection('passports', 'products')
  @Get('passports/funnel')
  @Roles(...VIEW)
  @ApiQuery({ name: 'category', required: false, description: 'Код категории паспорта: TRN, WRK, BLG, DIO, DSP' })
  funnel(@Query('category') category?: string) {
    return this.service.funnel(category);
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
  @ApiQuery({ name: 'category', required: false, enum: ['ALL', 'DIO', 'DSP', 'TRN', 'WRK', 'BLG'], description: 'Категория блока текста; нет версии категории — «Для всех»' })
  template(@Query('category') category?: string) {
    return this.service.template(category);
  }

  @Put('passports/template')
  @Roles(...EDIT)
  @AuditAction({ action: 'passport.template.updated', entityType: 'PassportTemplate' })
  saveTemplate(@Body() body: Partial<PassportTemplateContent> & { category?: string }, @CurrentUser() user?: AuthenticatedUser) {
    return this.service.saveTemplate(body, user?.id);
  }

  /**
   * «Разделы и тексты» v2 (БЗ-6 Э2d): общая часть «Для всех» (из кода, только чтение) + версия категории
   * (source: 'db' — из базы, 'code' — тексты категории из кода, версии в базе ещё нет) + дерево с пометками
   * «общий / категории / заменяет общий».
   */
  @Get('passports/texts')
  @Roles(...VIEW)
  @ApiQuery({ name: 'category', required: true, enum: ['DIO', 'DSP', 'TRN', 'WRK', 'BLG'] })
  texts(@Query('category') category?: string) {
    return this.service.texts(category);
  }

  /** Массовое изменение выбранных паспортов (БЗ-9): { ids, set, arrays?: { elements|materialIds: add|replace }, rebuildText? } → { updated, failed, before }. */
  @Post('passports/bulk')
  @HttpCode(200)
  @Roles(...EDIT)
  @AuditAction({ action: 'passport.bulk', entityType: 'ProductPassport', details: (d) => ({ updated: (d as { updated?: number }).updated }) })
  bulk(@Body() body: { ids?: unknown; set?: Record<string, unknown>; arrays?: Record<string, string>; rebuildText?: boolean }) {
    return this.service.bulk(body ?? {});
  }

  /** «Отменить» массовое изменение: { items: [{ id, set }] } (before из ответа bulk). */
  @Post('passports/bulk/restore')
  @HttpCode(200)
  @Roles(...EDIT)
  @AuditAction({ action: 'passport.bulk.restore', entityType: 'ProductPassport' })
  bulkRestore(@Body() body: { items?: Array<{ id?: string; set?: Record<string, unknown> }> }) {
    return this.service.bulkRestore(body ?? {});
  }

  /** Черновик формы: чего не хватает для выпуска ({missing:[{label,key}], requiredImages}) — ничего не пишет (ФП). */
  @Post('passports/check')
  @HttpCode(200)
  @Roles(...EDIT)
  check(@Body() body: Record<string, unknown>) {
    return this.service.check(body ?? {});
  }

  /** Предпросмотр собранного текста категории без сохранения: { category, own?: sections } (own нет — сохранённая версия). */
  @Post('passports/texts/preview')
  @HttpCode(200)
  @Roles(...VIEW)
  textsPreview(@Body() body: { category?: string; own?: PassportTemplateContent['sections'] | null }) {
    return this.service.textsPreview(body);
  }

  /** Новая версия текстов категории (как PUT /passports/template, но «Для всех» — 400: общая часть v2 в коде). */
  @Put('passports/texts')
  @Roles(...EDIT)
  @AuditAction({ action: 'passport.template.updated', entityType: 'PassportTemplate' })
  saveTexts(@Body() body: { category?: string; sections?: PassportTemplateContent['sections'] }, @CurrentUser() user?: AuthenticatedUser) {
    return this.service.saveTexts(body, user?.id);
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
   * ?mode=stand — лист «Правила пользования» для стенда, A3 книжный (паспорт без категории — 400).
   */
  @Get('passports/:id/pdf')
  @Roles(...EDIT)
  @ApiQuery({ name: 'stamp', required: false, description: '1 — с печатью и подписью' })
  @ApiQuery({ name: 'mode', required: false, enum: ['pages', 'print', 'stand'], description: 'pages — A5 постранично (умолч.); print — буклет на A4; stand — лист для стенда A3 (только v2)' })
  @ApiQuery({ name: 'bw', required: false, description: '1 — чёрно-белый (только v2; без цвета категории)' })
  @ApiQuery({ name: 'seal', required: false, description: 'при stamp=1: 0 — без печати (только подпись)' })
  @ApiQuery({ name: 'sign', required: false, description: 'при stamp=1: 0 — без подписи (только печать)' })
  async pdf(@Param('id') id: string, @Query('stamp') stamp: string, @Query('mode') mode: string, @Query('bw') bw: string, @Query('seal') seal: string, @Query('sign') sign: string, @Res({ passthrough: true }) res: Response) {
    const r = mode === 'stand' ? await this.pdfs.stand(id) : await this.pdfs.pdf(id, { stamp: stamp === '1', seal: seal !== '0', sign: sign !== '0', mode: mode === 'print' ? 'print' : 'pages', mono: bw === '1' });
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
    if (!r) throw new BadRequestException('У паспорта не выбрана категория — текст по справочникам не собирается. Выберите категорию в «Изменить»');
    return r;
  }

  /** Копия на ту же модель: новые номера, дата — сегодня, заказчик — пустой. */
  /** НМ: выпустить — номер, талон, номер изделия из счётчиков в одной транзакции; повтор — тот же номер; не хватает — 400 { missing }. */
  @Post('passports/:id/issue')
  @HttpCode(200)
  @Roles(...EDIT)
  @AuditAction({ action: 'passport.issued', entityType: 'ProductPassport', idParam: 'id' })
  issue(@Param('id') id: string) {
    return this.service.issue(id);
  }

  /** НМ: аннулировать выпущенный — { reason } обязателен; номер остаётся занятым. */
  @Post('passports/:id/annul')
  @HttpCode(200)
  @Roles(...EDIT)
  @AuditAction({ action: 'passport.annulled', entityType: 'ProductPassport', idParam: 'id' })
  annul(@Param('id') id: string, @Body() body: { reason?: string }) {
    return this.service.annul(id, body?.reason);
  }

  @Post('passports/:id/copy')
  @Roles(...EDIT)
  @AuditAction({ action: 'passport.copied', entityType: 'ProductPassport', idParam: 'id' })
  copy(@Param('id') id: string, @Body() dto: CreateProductPassportDto) {
    return this.service.copy(id, dto);
  }

  @Patch('passports/:id')
  @Roles(...EDIT)
  @AuditAction({ action: 'passport.updated', entityType: 'ProductPassport', idParam: 'id' })
  @ApiQuery({ name: 'newRevision', required: false, description: '1 — новая редакция выпущенного паспорта (номер тот же, редакция +1)' })
  update(@Param('id') id: string, @Body() dto: UpdateProductPassportDto, @Query('newRevision') newRevision?: string, @CurrentUser() user?: AuthenticatedUser) {
    return this.service.update(id, dto, { newRevision: newRevision === '1' || newRevision === 'true', user: user as never });
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
