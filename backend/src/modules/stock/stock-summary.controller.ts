import { Controller, Get, Param } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AppSection } from '../../common/decorators/app-section.decorator';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { StockScoped } from '../../common/decorators/stock-scoped.decorator';
import { canSeeMoney } from '../../common/roles-hierarchy';
import type { StockScope } from '../../common/stock-scope';
import { StockSummaryService } from './stock-summary.service';

/** Паспорт позиции номенклатуры одним запросом; путь `materials/…` — рядом с карточкой материала, живёт в модуле склада (без циклов). */
@ApiTags('Склад')
@Controller('materials')
export class StockSummaryController {
  constructor(private readonly summary: StockSummaryService) {}

  @AppSection('stock', 'requests')
  @Get(':id/summary')
  @Roles('admin', 'director', 'manager', 'user')
  @ApiOperation({ summary: 'Сводка позиции: остаток и места, поставщики, история цен, заявки, выдачи, аналитика по месяцам и заказчикам (цены — только ролям с деньгами)' })
  get(@Param('id') id: string, @StockScoped() scope: StockScope | null, @CurrentUser() user?: AuthenticatedUser) {
    return this.summary.summary(id, canSeeMoney(user), scope);
  }
}
