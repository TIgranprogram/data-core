import { Body, Controller, Delete, Get, HttpCode, Module, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiQuery, ApiTags } from '@nestjs/swagger';
import { AuditAction } from '../../common/decorators/audit-action.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CounterModule } from '../counter/counter.module';
import { ShowcaseService } from './showcase.service';

/** «Продукция»: витрина изделий, загрузка каталога, данные КП (TASKS БЗ-4). Смотреть — все, менять — менеджер+. */
@ApiTags('Продукция')
@Controller('showcase')
export class ShowcaseController {
  constructor(private readonly s: ShowcaseService) {}

  @Get()
  @Roles('admin', 'director', 'manager', 'user')
  @ApiQuery({ name: 'search', required: false }) @ApiQuery({ name: 'groupId', required: false }) @ApiQuery({ name: 'deleted', required: false }) @ApiQuery({ name: 'page', required: false }) @ApiQuery({ name: 'limit', required: false })
  list(@Query() q: Record<string, string>) { return this.s.list(q); }

  @Get('groups')
  @Roles('admin', 'director', 'manager', 'user')
  groups() { return this.s.groups(); }

  /** Подсказки формы изделия: разделы, группы, серии, цвета, размеры (ФИ). */
  @Get('form-values')
  @Roles('admin', 'director', 'manager', 'user')
  formValues() { return this.s.formValues(); }

  /** Массовое изменение выбранных изделий (БЗ-9): { ids, set, arrays?: { colors|sizes: add|replace } } → { updated, failed, before }. */
  @Post('bulk')
  @HttpCode(200)
  @Roles('admin', 'manager')
  @AuditAction({ action: 'showcase.bulk', entityType: 'Product', details: (d) => ({ updated: (d as { updated?: number }).updated }) })
  bulk(@Body() b: { ids?: unknown; set?: Record<string, unknown>; arrays?: Record<string, string> }) { return this.s.bulk(b ?? {}); }

  /** «Отменить» массовое изменение изделий: { items: [{ id, set }] }. */
  @Post('bulk/restore')
  @HttpCode(200)
  @Roles('admin', 'manager')
  @AuditAction({ action: 'showcase.bulk.restore', entityType: 'Product' })
  bulkRestore(@Body() b: { items?: Array<{ id?: string; set?: Record<string, unknown> }> }) { return this.s.bulkRestore(b ?? {}); }

  /** Каталог: text — колонки через Tab (вставка / прочитанный Excel), apply — записать (иначе только отчёт). */
  @Post('import')
  @HttpCode(200)
  @Roles('admin', 'manager')
  @AuditAction({ action: 'showcase.imported', entityType: 'Product', details: (d) => ({ result: { total: (d as { total?: number }).total, new: (d as { new?: number }).new, update: (d as { update?: number }).update } }) })
  import(@Body() b: { text?: string; apply?: boolean }) { return this.s.import(String(b?.text ?? ''), !!b?.apply); }

  /** Изделия из позиций заказов (БЗ-5): apply=false — отчёт, true — создать черновики и привязать позиции. */
  @Post('from-orders')
  @HttpCode(200)
  @Roles('admin', 'manager')
  @AuditAction({ action: 'showcase.from-orders', entityType: 'Product', details: (d) => ({ new: (d as { new?: number }).new, created: (d as { created?: number }).created }) })
  fromOrders(@Body() b: { apply?: boolean; picks?: { key?: string; name?: string }[] }) { return this.s.fromOrders(!!b?.apply, b?.picks); }

  /** Изделия из паспортов (БЗ-8): модели без изделия — группы-кандидаты на объединение и число одиночных. */
  @Get('from-passports')
  @Roles('admin', 'manager')
  passportGroups() { return this.s.passportGroups(); }

  /** Объединить группы в изделия { groups: [{ keys, main, name? }] } и/или изделия для остальных { rest: true }; паспорта получают productId. */
  @Post('from-passports')
  @HttpCode(200)
  @Roles('admin', 'manager')
  @AuditAction({ action: 'showcase.from-passports', entityType: 'Product', details: (d) => ({ created: (d as { created?: number }).created, linked: (d as { linked?: number }).linked }) })
  fromPassports(@Body() b: { groups?: { keys?: string[]; main?: string; name?: string }[]; rest?: boolean }) { return this.s.fromPassports(b ?? {}); }

  @Post('kp')
  @HttpCode(200)
  @Roles('admin', 'director', 'manager')
  @AuditAction({ action: 'showcase.kp', entityType: 'Product', details: (d) => ({ number: (d as { number?: string }).number, total: (d as { total?: number }).total }) })
  kp(@Body() b: { items?: { id: string; qty?: number; price?: number }[]; companyId?: string; customer?: string; note?: string }) { return this.s.kp(b ?? {}); }

  @Get(':id')
  @Roles('admin', 'director', 'manager', 'user')
  get(@Param('id') id: string) { return this.s.get(id); }

  /**
   * Состав изделия (БЗ-5, СИ): { lines: [{ lineType?: material|product|module, materialId | productId | moduleId, quantity, notes? }], types?: [...] }.
   * Старое тело (одни материалы) работает как раньше; строки других типов, которых нет в types, сохраняются. Цикл — 400.
   */
  @Put(':id/composition')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'showcase.composition', entityType: 'Product', idParam: 'id' })
  setComposition(@Param('id') id: string, @Body() b: { lines?: Array<{ lineType?: string; materialId?: string; productId?: string; moduleId?: string; quantity?: number | string; notes?: string }>; types?: string[] }) {
    return this.s.setComposition(id, b?.lines ?? [], b?.types);
  }

  /** «Часто в похожих изделиях» для состава (СИ): строки составов изделий той же группы. */
  @Get(':id/composition/similar')
  @Roles('admin', 'director', 'manager', 'user')
  compositionSimilar(@Param('id') id: string) { return this.s.compositionSimilar(id); }

  /** Значения паспорта по умолчанию (БЗ-6 Э4b): { passportCategory, elements[], materialIds[], installationTypeId, isKit, ageFrom… }. Правят директор и админ (как паспорта). */
  @Put(':id/passport-defaults')
  @Roles('admin', 'director')
  @AuditAction({ action: 'showcase.passportDefaults', entityType: 'Product', idParam: 'id' })
  setPassportDefaults(@Param('id') id: string, @Body() b: Record<string, unknown>) { return this.s.setPassportDefaults(id, b ?? {}); }

  @Post()
  @Roles('admin', 'manager')
  @AuditAction({ action: 'showcase.created', entityType: 'Product' })
  create(@Body() b: Record<string, unknown>) { return this.s.create(b ?? {}, { requireType: true }); }

  @Patch(':id')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'showcase.updated', entityType: 'Product', idParam: 'id' })
  update(@Param('id') id: string, @Body() b: Record<string, unknown>) { return this.s.update(id, b ?? {}); }

  @Delete(':id')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'showcase.deleted', entityType: 'Product', idParam: 'id' })
  remove(@Param('id') id: string) { return this.s.remove(id); }

  @Post(':id/restore')
  @HttpCode(200)
  @Roles('admin', 'manager')
  @AuditAction({ action: 'showcase.restored', entityType: 'Product', idParam: 'id' })
  restore(@Param('id') id: string) { return this.s.restore(id); }
}

@Module({ imports: [CounterModule], controllers: [ShowcaseController], providers: [ShowcaseService] })
export class ShowcaseModule {}
