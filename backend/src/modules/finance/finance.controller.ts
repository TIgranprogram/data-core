import { FinancialOperationsReader } from './financial-operations-reader.service';
import { FinancialClassificationService } from './financial-classification.service';
import { OperationsQueryDto, ClassificationDto } from './operations.dto';
import { StockScoped } from '../../common/decorators/stock-scoped.decorator';
import type { StockScope } from '../../common/stock-scope';
import { CurrentUser, type AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { MoneyAccessGuard } from '../../common/guards/money-access.guard';
import { AppSection } from '../../common/decorators/app-section.decorator';
import { Body, Controller, Get, Optional, Param, Patch, Put, Query, UseGuards } from '@nestjs/common';
import { ApiQuery, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuditAction } from '../../common/decorators/audit-action.decorator';
import { SettingsDto } from './dto';
import { FinanceService } from './finance.service';

/** Деньги: платёжный календарь (ОДР) и сводка по СИЮ / ССЮ. Только чтение, все роли. */
@ApiTags('Деньги')
@AppSection('money')
@UseGuards(MoneyAccessGuard)
@Controller('finance')
export class FinanceController {
  constructor(private readonly finance: FinanceService, @Optional() private readonly operations?: FinancialOperationsReader, @Optional() private readonly classifications?: FinancialClassificationService) {}

  @Get('operations') @Roles('admin', 'manager')
  operationsList(@Query() q: OperationsQueryDto, @CurrentUser() user?: AuthenticatedUser, @StockScoped() scope: StockScope | null = null) { return this.operations!.list(q as unknown as Record<string, unknown>, user, scope); }

  @Get('operations/:operationId') @Roles('admin', 'manager')
  operation(@Param('operationId') id: string, @CurrentUser() user?: AuthenticatedUser, @StockScoped() scope: StockScope | null = null) { return this.operations!.detail(id, user, scope); }

  @Patch('operations/:operationId/classification') @Roles('admin', 'manager')
  async classification(@Param('operationId') id: string, @Body() dto: ClassificationDto, @CurrentUser() user: AuthenticatedUser, @StockScoped() scope: StockScope | null = null) { const result = await this.classifications!.apply(id, dto, user, scope); return result.replayed ? this.operations!.replayView(result.operationId, result.replayed as Parameters<FinancialOperationsReader['replayView']>[1], user, scope) : this.operations!.detail(result.operationId, user, scope); }

  @Get('cashflow')
  @Roles('admin', 'accountant', 'manager')
  @ApiQuery({ name: 'from', required: false, description: 'ГГГГ-ММ-ДД (умолч. начало месяца)' })
  @ApiQuery({ name: 'to', required: false, description: 'ГГГГ-ММ-ДД (умолч. конец месяца); период ≤ 1 года' })
  @ApiQuery({ name: 'org', required: false, description: 'all | СИЮ | ССЮ | id организации' })
  @ApiQuery({ name: 'opening', required: false, description: 'Остаток на начало периода, ₽' })
  cashflow(@Query() q: Record<string, string>, @StockScoped() scope: StockScope | null = null, @CurrentUser() actor?: AuthenticatedUser) {
    return this.finance.cashflow(q, scope, actor);
  }

  @Get('summary')
  @Roles('admin', 'accountant', 'manager')
  @ApiQuery({ name: 'from', required: false }) @ApiQuery({ name: 'to', required: false }) @ApiQuery({ name: 'org', required: false })
  summary(@Query() q: Record<string, string>, @StockScoped() scope: StockScope | null = null, @CurrentUser() actor?: AuthenticatedUser) {
    return this.finance.summary(q, scope, actor);
  }

  /** Прогноз (БЗ-1): ожидаемые выплаты и поступления вперёд, остаток по дням, кассовый разрыв. Отдельно от факта. */
  @Get('forecast')
  @Roles('admin', 'accountant', 'manager')
  @ApiQuery({ name: 'days', required: false, description: '7–180, по умолчанию 30' })
  @ApiQuery({ name: 'opening', required: false, description: 'Остаток денег на сегодня, ₽' })
  @ApiQuery({ name: 'org', required: false, description: 'all | СИЮ | ССЮ | id' })
  forecast(@Query() q: Record<string, string>, @StockScoped() scope: StockScope | null = null, @CurrentUser() actor?: AuthenticatedUser) {
    return this.finance.forecast(q, scope, actor);
  }

  /** «По статьям»: статья → подстатья × месяцы года (только факт); режим «по объекту» — один заказ заказчика. */
  @Get('by-articles')
  @Roles('admin', 'accountant', 'manager')
  @ApiQuery({ name: 'year', required: false, description: 'Год (умолч. текущий)' })
  @ApiQuery({ name: 'org', required: false, description: 'all | СИЮ | ССЮ | id' })
  @ApiQuery({ name: 'mode', required: false, description: 'company (вся фирма, умолч.) | object' })
  @ApiQuery({ name: 'salesOrderId', required: false, description: 'Объект — заказ заказчика (для mode=object)' })
  @ApiQuery({ name: 'productionNo', required: false, description: 'Производственный заказ со всеми договорами' })
  @ApiQuery({ name: 'salesOrderLineId', required: false, description: 'Позиция заказа' })
  @ApiQuery({ name: 'personId', required: false, description: 'Получатель фактической выплаты ФОТ' })
  @ApiQuery({ name: 'facets', required: false, enum: [0, 1], description: 'Доступные позиции и сотрудники по фильтрам' })
  @ApiQuery({ name: 'counterparty', required: false, description: 'Точное имя заказчика или контрагента' })
  @ApiQuery({ name: 'doc', required: false, description: 'Точное название из группировки операций по документам' })
  byArticles(@Query() q: Record<string, string>, @CurrentUser() user?: AuthenticatedUser, @StockScoped() scope: StockScope | null = null) {
    return this.operations!.byArticles(q, user, scope);
  }

  /** Операции одной ячейки «По статьям»: articleId — подстатья, статья, none, income, expense, unallocated; month — ГГГГ-ММ. */
  @Get('by-articles/ops')
  @Roles('admin', 'accountant', 'manager')
  @ApiQuery({ name: 'articleId', required: true, description: 'id подстатьи / статьи | <id статьи>:self («Без подстатьи») | none | income | expense | unallocated' })
  @ApiQuery({ name: 'month', required: false, description: 'ГГГГ-ММ; пусто — весь год' })
  @ApiQuery({ name: 'counterparty', required: false, description: 'Точное имя контрагента/заказчика; «Контрагент не указан» / «Заказчик не указан» — пустое' })
  @ApiQuery({ name: 'doc', required: false, description: 'Точный документ (для доходов — «заказ 123»); «Без заказа» — пустой' })
  @ApiQuery({ name: 'year', required: false }) @ApiQuery({ name: 'org', required: false }) @ApiQuery({ name: 'mode', required: false }) @ApiQuery({ name: 'salesOrderId', required: false })
  byArticlesOps(@Query() q: Record<string, string>, @StockScoped() scope: StockScope | null = null, @CurrentUser() actor?: AuthenticatedUser) {
    return this.finance.byArticlesOps(q, scope, actor);
  }

  /** «Старт учёта»: дата и остатки на счетах наших компаний; от неё считаются остаток календаря и прогноз. */
  @Get('settings')
  @Roles('admin', 'accountant')
  settings() {
    return this.finance.settings();
  }

  @Put('settings')
  @Roles('admin')
  @AuditAction({ action: 'finance.settings.saved', entityType: 'FinanceSettings' })
  saveSettings(@Body() b: SettingsDto) {
    return this.finance.saveSettings(b);
  }

  /** Записи, которые не попадают в расчёт: чего не хватает. */
  @Get('needs-fill')
  @Roles('admin', 'accountant', 'manager')
  needsFill(@StockScoped() scope: StockScope | null = null, @CurrentUser() actor?: AuthenticatedUser) {
    return this.finance.needsFill(300, scope, actor);
  }
}
