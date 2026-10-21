import { Body, Controller, Delete, Get, HttpCode, Module, Param, Patch, Post, Query } from '@nestjs/common';
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

  /** Каталог: text — колонки через Tab (вставка / прочитанный Excel), apply — записать (иначе только отчёт). */
  @Post('import')
  @HttpCode(200)
  @Roles('admin', 'manager')
  @AuditAction({ action: 'showcase.imported', entityType: 'Product', details: (d) => ({ result: { total: (d as { total?: number }).total, new: (d as { new?: number }).new, update: (d as { update?: number }).update } }) })
  import(@Body() b: { text?: string; apply?: boolean }) { return this.s.import(String(b?.text ?? ''), !!b?.apply); }

  @Post('kp')
  @HttpCode(200)
  @Roles('admin', 'director', 'manager')
  @AuditAction({ action: 'showcase.kp', entityType: 'Product', details: (d) => ({ number: (d as { number?: string }).number, total: (d as { total?: number }).total }) })
  kp(@Body() b: { items?: { id: string; qty?: number; price?: number }[]; companyId?: string; customer?: string; note?: string }) { return this.s.kp(b ?? {}); }

  @Get(':id')
  @Roles('admin', 'director', 'manager', 'user')
  get(@Param('id') id: string) { return this.s.get(id); }

  @Post()
  @Roles('admin', 'manager')
  @AuditAction({ action: 'showcase.created', entityType: 'Product' })
  create(@Body() b: Record<string, unknown>) { return this.s.create(b ?? {}); }

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
