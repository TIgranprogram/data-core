import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseInterceptors } from '@nestjs/common';
import { ApiQuery, ApiTags } from '@nestjs/swagger';
import { AuditAction } from '../../common/decorators/audit-action.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, type AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { MoneyMaskInterceptor } from '../../common/interceptors/money-mask.interceptor';
import { DictsService } from './dicts.service';
import { canSeePayroll } from '../../common/roles-hierarchy';
import { openSectionsFor, sectionOpen } from '../../common/app-sections';
import { hidePayroll } from './dicts.payroll';

/** SK-8d: «Сотрудники» без оплаты, если раздел «ФОТ» для роли закрыт. */
const payrollMask = <T>(key: string, user: AuthenticatedUser | undefined, res: T): T =>
  key === 'persons' && (!canSeePayroll(user) || !sectionOpen(openSectionsFor(user), 'payroll')) ? hidePayroll(res) : res;

/** Ставку и вид оплаты не принимаем от тех, кому ФОТ закрыт. */
const payrollBody = (key: string, user: AuthenticatedUser | undefined, body: Record<string, unknown>) => {
  if (key === 'persons' && !canSeePayroll(user) && body) { delete body.salaryRate; delete body.salaryKind; }
  return body;
};

/**
 * «Справочники» приложения (TASKS СП.4–СП.8): категории, единицы, цвета, сотрудники, виды работ, графики выплат,
 * типы счетов, услуги. Читают все; правят — менеджер и старше; ставка сотрудника видна только денежным ролям.
 * В журнал изменений пишется под entityType `DictItem`, entityId — ObjectId записи.
 */
@ApiTags('Справочники')
@UseInterceptors(MoneyMaskInterceptor)
@Controller('dicts')
export class DictsController {
  constructor(private readonly dicts: DictsService) {}

  @Get()
  @Roles('user')
  groups() {
    return this.dicts.groups();
  }

  @Get(':key')
  @Roles('user')
  @ApiQuery({ name: 'search', required: false })
  async list(@Param('key') key: string, @Query('search') search?: string, @CurrentUser() user?: AuthenticatedUser) {
    return payrollMask(key, user, await this.dicts.list(key, search));
  }

  @Get(':key/candidates')
  @Roles('manager')
  candidates(@Param('key') key: string) {
    return this.dicts.candidates(key);
  }

  @Post(':key/import')
  @HttpCode(200)
  @Roles('manager')
  @AuditAction({ action: 'dict.imported', entityType: 'DictItem', details: (d, p) => ({ meta: { dict: p.key, ...(d as object) } }) })
  importNames(@Param('key') key: string, @Body() body: { names?: string[] }, @CurrentUser() user: AuthenticatedUser) {
    this.dicts.assertCanEdit(key, user);
    return this.dicts.importNames(key, body?.names);
  }

  /** Занято ли значение и где (объявлен раньше общего `:key/:id`). */
  @Get(':key/:id/usage')
  @Roles('user')
  usage(@Param('key') key: string, @Param('id') id: string) {
    return this.dicts.usage(key, id);
  }

  @Get(':key/:id')
  @Roles('user')
  async get(@Param('key') key: string, @Param('id') id: string, @CurrentUser() user?: AuthenticatedUser) {
    return payrollMask(key, user, await this.dicts.get(key, id));
  }

  @Post(':key')
  @Roles('manager')
  @AuditAction({ action: 'dict.created', entityType: 'DictItem' })
  async create(@Param('key') key: string, @Body() body: Record<string, unknown>, @CurrentUser() user: AuthenticatedUser) {
    this.dicts.assertCanEdit(key, user);
    return payrollMask(key, user, await this.dicts.create(key, payrollBody(key, user, body)));
  }

  @Patch(':key/:id')
  @Roles('manager')
  @AuditAction({ action: 'dict.updated', entityType: 'DictItem', idParam: 'id' })
  async update(@Param('key') key: string, @Param('id') id: string, @Body() body: Record<string, unknown>, @CurrentUser() user: AuthenticatedUser) {
    this.dicts.assertCanEdit(key, user);
    return payrollMask(key, user, await this.dicts.update(key, id, payrollBody(key, user, body)));
  }

  @Delete(':key/:id')
  @Roles('manager')
  @AuditAction({ action: 'dict.deleted', entityType: 'DictItem', idParam: 'id', details: (_d, p) => ({ meta: { dict: p.key } }) })
  remove(@Param('key') key: string, @Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    this.dicts.assertCanEdit(key, user);
    return this.dicts.remove(key, id, user);
  }

  @Post(':key/:id/restore')
  @HttpCode(200)
  @Roles('manager')
  @AuditAction({ action: 'dict.restored', entityType: 'DictItem', idParam: 'id', details: (_d, p) => ({ meta: { dict: p.key } }) })
  async restore(@Param('key') key: string, @Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    this.dicts.assertCanEdit(key, user);
    return payrollMask(key, user, await this.dicts.restore(key, id));
  }

  @Post(':key/:id/merge')
  @HttpCode(200)
  @Roles('manager')
  // журнал «dict.merged» (с id перенесённых записей) пишет сам сервис
  merge(@Param('key') key: string, @Param('id') id: string, @Body() body: { intoId?: string }, @CurrentUser() user: AuthenticatedUser) {
    this.dicts.assertCanEdit(key, user);
    return this.dicts.merge(key, id, String(body?.intoId ?? ''), user);
  }
}
