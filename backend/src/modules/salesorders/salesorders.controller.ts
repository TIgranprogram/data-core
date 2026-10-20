import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseInterceptors } from '@nestjs/common';
import { MoneyMaskInterceptor } from '../../common/interceptors/money-mask.interceptor';
import { ApiQuery, ApiTags } from '@nestjs/swagger';
import { AuditAction } from '../../common/decorators/audit-action.decorator';
import { CurrentUser, type AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { SalesOrderDto } from './dto';
import { SalesOrdersService } from './salesorders.service';

/**
 * Заказы заказчиков — шапки (TASKS З.1). Позиции добавляются/правятся через /api/incomes с `orderId`.
 * Смотреть — все роли, менять — admin и manager (как доходы и снабжение).
 */
@ApiTags('Заказы заказчиков')
@UseInterceptors(MoneyMaskInterceptor) // суммы — только админ / директор / бухгалтер
@Controller('salesorders')
export class SalesOrdersController {
  constructor(private readonly orders: SalesOrdersService) {}

  @Get()
  @Roles('admin', 'director', 'manager', 'user')
  @ApiQuery({ name: 'page', required: false }) @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'search', required: false, description: '№ заказа, заказчик, предмет, № контракта, примечание' })
  @ApiQuery({ name: 'sort', required: false, description: 'orderNo | customer | stage | shipDate | productionDeadline | deliveryDeadline | contractDate | createdAt | updatedAt; «-» — по убыванию (умолч. -createdAt)' })
  @ApiQuery({ name: 'filter', required: false, description: 'active (новый / в производстве / готов) | done (отгружен / закрыт) | all' })
  @ApiQuery({ name: 'stage', required: false, description: 'этапы через запятую: new, production, ready, shipped, closed, cancelled' })
  @ApiQuery({ name: 'companyId', required: false })
  @ApiQuery({ name: 'from', required: false, description: 'по дате отгрузки, ГГГГ-ММ-ДД' }) @ApiQuery({ name: 'to', required: false })
  @ApiQuery({ name: 'deleted', required: false, description: '1 — корзина' })
  list(@Query() q: Record<string, string>) {
    return this.orders.list(q);
  }

  /** Карточка: шапка + позиции (lines) + заявки снабжения (supplyRequests) + движения склада (stockMovements). */
  @Get(':id')
  @Roles('admin', 'director', 'manager', 'user')
  get(@Param('id') id: string) {
    return this.orders.get(id);
  }

  @Post()
  @Roles('admin', 'manager')
  @AuditAction({ action: 'salesorder.created', entityType: 'SalesOrder' })
  create(@Body() dto: SalesOrderDto, @CurrentUser() user?: AuthenticatedUser) {
    return this.orders.create(dto, user?.id);
  }

  @Patch(':id')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'salesorder.updated', entityType: 'SalesOrder', idParam: 'id' })
  update(@Param('id') id: string, @Body() dto: SalesOrderDto) {
    return this.orders.update(id, dto);
  }

  @Delete(':id')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'salesorder.deleted', entityType: 'SalesOrder', idParam: 'id' })
  remove(@Param('id') id: string) {
    return this.orders.remove(id);
  }

  @Post(':id/restore')
  @HttpCode(200)
  @Roles('admin', 'manager')
  @AuditAction({ action: 'salesorder.restored', entityType: 'SalesOrder', idParam: 'id' })
  restore(@Param('id') id: string) {
    return this.orders.restore(id);
  }
}
