import { Body, Controller, Get, HttpCode, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AppSection } from '../../common/decorators/app-section.decorator';
import { AuditAction } from '../../common/decorators/audit-action.decorator';
import { CurrentUser, type AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ApplyToProductDto, CheckDto, SavePlanDto, StepMarkDto, StepPatchDto } from './dto/order-line-plan.dto';
import { ScheduleQueryDto } from './dto/work-schedule.dto';
import { OrderLinePlanService } from './order-line-plan.service';
import { WorkScheduleService } from './work-schedule.service';

/** Гант-планирование: полосы шагов по людям и заказам, загрузка по дням. */
@ApiTags('В работе')
@AppSection('work', 'salesorders', 'orders', 'products')
@Controller('work-schedule')
export class WorkScheduleController {
  constructor(private readonly schedule: WorkScheduleService) {}

  @Get()
  @Roles('admin', 'director', 'manager', 'user')
  get(@Query() q: ScheduleQueryDto) {
    return this.schedule.schedule(q);
  }
}

/** План позиции заказа: части и виды работ, «Проверено», перенос в изделие. Править — admin и manager. */
@ApiTags('В работе')
@AppSection('work', 'salesorders', 'orders', 'products')
@Controller('orderline-plans')
export class OrderLinePlanController {
  constructor(private readonly plans: OrderLinePlanService, private readonly schedule: WorkScheduleService) {}

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

  /** Гант: назначить исполнителя шага и/или сдвинуть даты. Ответ — полоса и загрузка затронутых людей. */
  @Patch(':id/steps/:stepId')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'orderlineplan.step', entityType: 'OrderLinePlan', idParam: 'id' })
  patchStep(@Param('id') id: string, @Param('stepId') stepId: string, @Body() dto: StepPatchDto) {
    return this.schedule.patchStep(id, stepId, dto);
  }

  /** «Отметить начало / конец» шага. */
  @Post(':id/steps/:stepId/mark')
  @HttpCode(200)
  @Roles('admin', 'manager')
  @AuditAction({ action: 'orderlineplan.step.mark', entityType: 'OrderLinePlan', idParam: 'id' })
  mark(@Param('id') id: string, @Param('stepId') stepId: string, @Body() dto: StepMarkDto) {
    return this.schedule.mark(id, stepId, dto.what);
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
