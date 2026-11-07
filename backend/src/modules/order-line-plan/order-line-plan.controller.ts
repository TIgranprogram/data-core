import { Body, Controller, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AppSection } from '../../common/decorators/app-section.decorator';
import { AuditAction } from '../../common/decorators/audit-action.decorator';
import { CurrentUser, type AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ApplyToProductDto, CheckDto, SavePlanDto } from './dto/order-line-plan.dto';
import { OrderLinePlanService } from './order-line-plan.service';

/** План позиции заказа: части и виды работ, «Проверено», перенос в изделие. Править — admin и manager. */
@ApiTags('В работе')
@AppSection('work', 'salesorders', 'orders', 'products')
@Controller('orderline-plans')
export class OrderLinePlanController {
  constructor(private readonly plans: OrderLinePlanService) {}

  /** План позиции; при первом открытии создаётся копией из изделия (нет изделия — пустой ручной). */
  @Get('by-income/:incomeId')
  @Roles('admin', 'director', 'manager', 'user')
  byIncome(@Param('incomeId') incomeId: string) {
    return this.plans.byIncome(incomeId);
  }

  /** Записать части и шаги целиком; `rev` старый — 409. */
  @Put(':id')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'orderlineplan.updated', entityType: 'OrderLinePlan', idParam: 'id' })
  save(@Param('id') id: string, @Body() dto: SavePlanDto, @CurrentUser() user?: AuthenticatedUser) {
    return this.plans.save(id, dto, user?.id);
  }

  /** Зелёная галочка «Проверено» у части или шага. */
  @Post(':id/check')
  @HttpCode(200)
  @Roles('admin', 'manager')
  check(@Param('id') id: string, @Body() dto: CheckDto, @CurrentUser() user?: AuthenticatedUser) {
    return this.plans.check(id, dto, user?.id);
  }

  /** «И в продукцию»: части и маршрут плана записываются в изделие; изделие менялось — 409. */
  @Post(':id/apply-to-product')
  @HttpCode(200)
  @Roles('admin', 'manager')
  @AuditAction({ action: 'orderlineplan.applied', entityType: 'OrderLinePlan', idParam: 'id' })
  apply(@Param('id') id: string, @Body() dto: ApplyToProductDto) {
    return this.plans.applyToProduct(id, dto);
  }

  /** «Изделие изменилось — взять заново»: план пересобирается из изделия. */
  @Post(':id/reset-from-product')
  @HttpCode(200)
  @Roles('admin', 'manager')
  @AuditAction({ action: 'orderlineplan.reset', entityType: 'OrderLinePlan', idParam: 'id' })
  reset(@Param('id') id: string) {
    return this.plans.resetFromProduct(id);
  }
}
