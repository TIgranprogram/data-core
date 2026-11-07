import { Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AppSection } from '../../common/decorators/app-section.decorator';
import { AuditAction } from '../../common/decorators/audit-action.decorator';
import { CurrentUser, type AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { canSeeMoney } from '../../common/roles-hierarchy';
import { WorkFactsService } from './work-facts.service';

/**
 * C041 Э3 — факт, нормы, себестоимость: «Фактически» изделия (медиана последних 5 заказов), «Принять как норму»,
 * себестоимость позиции/изделия. Деньги — только ролям с правом «Деньги» (без него ответ `{hidden:true}`).
 */
@ApiTags('В работе')
@AppSection('work', 'products', 'salesorders')
@Controller('work-facts')
export class WorkFactsController {
  constructor(private readonly facts: WorkFactsService) {}

  /** «Фактически» изделия по шагам и всего: медиана факта последних 5 заказов и текущая норма. */
  @Get('product/:productId')
  @Roles('admin', 'director', 'manager', 'user')
  product(@Param('productId') productId: string) {
    return this.facts.productFacts(productId);
  }

  /** «Принять как норму»: медианы факта записываются в маршрут изделия (норма часов на 1 шт.). */
  @Post('product/:productId/apply')
  @HttpCode(200)
  @Roles('admin', 'manager')
  @AuditAction({ action: 'workfact.applied', entityType: 'Product', idParam: 'productId', details: (d) => ({ applied: (d as { applied?: number })?.applied }) })
  apply(@Param('productId') productId: string) {
    return this.facts.applyNorm(productId);
  }

  /** Себестоимость позиции заказа или изделия: материалы (состав × последняя закупка) + работы (часы × ставка). */
  @Get('cost')
  @Roles('admin', 'director', 'manager', 'user')
  cost(@Query('incomeId') incomeId?: string, @Query('productId') productId?: string, @CurrentUser() user?: AuthenticatedUser) {
    return this.facts.cost({ incomeId, productId }, canSeeMoney(user));
  }
}
