import { MoneyAccessGuard } from '../../common/guards/money-access.guard';
import { AppSection } from '../../common/decorators/app-section.decorator';
import { Body, Controller, Get, Put, Query, UseGuards } from '@nestjs/common';
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
  constructor(private readonly finance: FinanceService) {}

  @Get('cashflow')
  @Roles('admin', 'accountant', 'manager')
  @ApiQuery({ name: 'from', required: false, description: 'ГГГГ-ММ-ДД (умолч. начало месяца)' })
  @ApiQuery({ name: 'to', required: false, description: 'ГГГГ-ММ-ДД (умолч. конец месяца); период ≤ 1 года' })
  @ApiQuery({ name: 'org', required: false, description: 'all | СИЮ | ССЮ | id организации' })
  @ApiQuery({ name: 'opening', required: false, description: 'Остаток на начало периода, ₽' })
  cashflow(@Query() q: Record<string, string>) {
    return this.finance.cashflow(q);
  }

  @Get('summary')
  @Roles('admin', 'accountant', 'manager')
  @ApiQuery({ name: 'from', required: false }) @ApiQuery({ name: 'to', required: false }) @ApiQuery({ name: 'org', required: false })
  summary(@Query() q: Record<string, string>) {
    return this.finance.summary(q);
  }

  /** Прогноз (БЗ-1): ожидаемые выплаты и поступления вперёд, остаток по дням, кассовый разрыв. Отдельно от факта. */
  @Get('forecast')
  @Roles('admin', 'accountant', 'manager')
  @ApiQuery({ name: 'days', required: false, description: '7–180, по умолчанию 30' })
  @ApiQuery({ name: 'opening', required: false, description: 'Остаток денег на сегодня, ₽' })
  @ApiQuery({ name: 'org', required: false, description: 'all | СИЮ | ССЮ | id' })
  forecast(@Query() q: Record<string, string>) {
    return this.finance.forecast(q);
  }

  /** «По статьям»: статья → подстатья × месяцы года (только факт); режим «по объекту» — один заказ заказчика. */
  @Get('by-articles')
  @Roles('admin', 'accountant', 'manager')
  @ApiQuery({ name: 'year', required: false, description: 'Год (умолч. текущий)' })
  @ApiQuery({ name: 'org', required: false, description: 'all | СИЮ | ССЮ | id' })
  @ApiQuery({ name: 'mode', required: false, description: 'company (вся фирма, умолч.) | object' })
  @ApiQuery({ name: 'salesOrderId', required: false, description: 'Объект — заказ заказчика (для mode=object)' })
  byArticles(@Query() q: Record<string, string>) {
    return this.finance.byArticles(q);
  }

  /** Операции одной ячейки «По статьям»: articleId — подстатья, статья, none, income, expense, unallocated; month — ГГГГ-ММ. */
  @Get('by-articles/ops')
  @Roles('admin', 'accountant', 'manager')
  @ApiQuery({ name: 'articleId', required: true, description: 'id подстатьи / статьи | none | income | expense | unallocated' })
  @ApiQuery({ name: 'month', required: false, description: 'ГГГГ-ММ; пусто — весь год' })
  @ApiQuery({ name: 'year', required: false }) @ApiQuery({ name: 'org', required: false }) @ApiQuery({ name: 'mode', required: false }) @ApiQuery({ name: 'salesOrderId', required: false })
  byArticlesOps(@Query() q: Record<string, string>) {
    return this.finance.byArticlesOps(q);
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
  needsFill() {
    return this.finance.needsFill();
  }
}
