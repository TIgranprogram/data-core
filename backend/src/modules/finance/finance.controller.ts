import { Controller, Get, Query } from '@nestjs/common';
import { ApiQuery, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { FinanceService } from './finance.service';

/** Деньги: платёжный календарь (ОДР) и сводка по СИЮ / ССЮ. Только чтение, все роли. */
@ApiTags('Деньги')
@Controller('finance')
export class FinanceController {
  constructor(private readonly finance: FinanceService) {}

  @Get('cashflow')
  @Roles('admin', 'accountant')
  @ApiQuery({ name: 'from', required: false, description: 'ГГГГ-ММ-ДД (умолч. начало месяца)' })
  @ApiQuery({ name: 'to', required: false, description: 'ГГГГ-ММ-ДД (умолч. конец месяца); период ≤ 1 года' })
  @ApiQuery({ name: 'org', required: false, description: 'all | СИЮ | ССЮ | id организации' })
  @ApiQuery({ name: 'opening', required: false, description: 'Остаток на начало периода, ₽' })
  cashflow(@Query() q: Record<string, string>) {
    return this.finance.cashflow(q);
  }

  @Get('summary')
  @Roles('admin', 'accountant')
  @ApiQuery({ name: 'from', required: false }) @ApiQuery({ name: 'to', required: false }) @ApiQuery({ name: 'org', required: false })
  summary(@Query() q: Record<string, string>) {
    return this.finance.summary(q);
  }

  /** Прогноз (БЗ-1): ожидаемые выплаты и поступления вперёд, остаток по дням, кассовый разрыв. Отдельно от факта. */
  @Get('forecast')
  @Roles('admin', 'accountant')
  @ApiQuery({ name: 'days', required: false, description: '7–180, по умолчанию 30' })
  @ApiQuery({ name: 'opening', required: false, description: 'Остаток денег на сегодня, ₽' })
  @ApiQuery({ name: 'org', required: false, description: 'all | СИЮ | ССЮ | id' })
  forecast(@Query() q: Record<string, string>) {
    return this.finance.forecast(q);
  }

  /** Записи, которые не попадают в расчёт: чего не хватает. */
  @Get('needs-fill')
  @Roles('admin', 'accountant')
  needsFill() {
    return this.finance.needsFill();
  }
}
