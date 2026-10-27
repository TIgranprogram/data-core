import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseInterceptors, UseGuards } from '@nestjs/common';
import { MoneyMaskInterceptor } from '../../common/interceptors/money-mask.interceptor';
import { ApiQuery, ApiTags } from '@nestjs/swagger';
import { AuditAction } from '../../common/decorators/audit-action.decorator';
import { ConfirmTokenGuard } from '../../common/guards/confirm-token.guard';
import { CurrentUser, type AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AppSection } from '../../common/decorators/app-section.decorator';
import { openSectionsFor, sectionOpen } from '../../common/app-sections';
import { MatchProductsDto, SalesOrderDto } from './dto';
import { SalesOrdersService } from './salesorders.service';

/**
 * Заказы заказчиков — шапки (TASKS З.1). Позиции добавляются/правятся через /api/incomes с `orderId`.
 * Смотреть — все роли, менять — admin и manager (как доходы и снабжение).
 */
@ApiTags('Заказы заказчиков')
@UseInterceptors(MoneyMaskInterceptor) // суммы — только админ / директор / бухгалтер
@AppSection('salesorders')
@Controller('salesorders')
export class SalesOrdersController {
  constructor(private readonly orders: SalesOrdersService) {}

  @Get()
  @Roles('admin', 'director', 'manager', 'user')
  @ApiQuery({ name: 'page', required: false }) @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'search', required: false, description: '№ заказа, заказчик, предмет, № контракта, № на производство, примечание' })
  @ApiQuery({ name: 'sort', required: false, description: 'orderNo | customer | stage | priority | shipDate | productionDeadline | deliveryDeadline | contractDate | createdAt | updatedAt; «-» — по убыванию (умолч. -createdAt)' })
  @ApiQuery({ name: 'filter', required: false, description: 'active (новый / в производстве / готов) | done (отгружен / закрыт) | all' })
  @ApiQuery({ name: 'stage', required: false, description: 'этапы через запятую: new, production, ready, shipped, closed, cancelled' })
  @ApiQuery({ name: 'companyId', required: false })
  @ApiQuery({ name: 'priority', required: false, description: 'приоритеты через запятую: urgent, high, normal (включает заказы без приоритета), low' })
  @ApiQuery({ name: 'from', required: false, description: 'по дате отгрузки, ГГГГ-ММ-ДД' }) @ApiQuery({ name: 'to', required: false })
  @ApiQuery({ name: 'deleted', required: false, description: '1 — корзина' })
  list(@Query() q: Record<string, string>) {
    return this.orders.list(q);
  }

  /** Следующий № на производство («21-26»): max N за год + 1 — объявлен до `:id`. */
  @Get('next-production-no')
  @Roles('admin', 'director', 'manager', 'user')
  @ApiQuery({ name: 'year', required: false, description: 'год, умолч. текущий' })
  nextProductionNo(@Query() q: Record<string, string>) {
    return this.orders.nextProductionNo(q);
  }

  /** SK-8d: короткий список заказов без денег для «Склада», «Заявок», «Паспортов», «Проектирования» — объявлен до `:id`. */
  @AppSection('salesorders', 'stock', 'requests', 'passports', 'design')
  @Get('lookup')
  @Roles('admin', 'director', 'manager', 'user')
  @ApiQuery({ name: 'filter', required: false, description: 'active (по умолч.: новый / в производстве / готов) | all' })
  @ApiQuery({ name: 'lines', required: false, description: '1 — с позициями [{id, lineNo, title, qty, productId}]' })
  lookup(@Query() q: Record<string, string>) {
    return this.orders.lookup(q);
  }

  /**
   * Карточка: шапка + позиции (lines) + заявки снабжения (supplyRequests) + движения склада (stockMovements).
   * SK-8d: закрыты «Заявки» — supplyRequests пустой; закрыт «Склад» — stockMovements и issuedByLine пустые.
   */
  @Get(':id')
  @Roles('admin', 'director', 'manager', 'user')
  get(@Param('id') id: string, @CurrentUser() user?: AuthenticatedUser) {
    const open = openSectionsFor(user);
    return this.orders.get(id, { requests: sectionOpen(open, 'requests'), stock: sectionOpen(open, 'stock') });
  }

  /** Позиции заказа для выдачи со склада: [{id, orderNo, lineNo, title, productId, photoId, qty}] — без цен, photoId: фото позиции → фото изделия → null. */
  @AppSection('salesorders', 'stock', 'requests', 'design')
  @Get(':id/lines-lookup')
  @Roles('admin', 'director', 'manager', 'user')
  linesLookup(@Param('id') id: string) {
    return this.orders.linesLookup(id);
  }

  /** ПРЖ-4: подбор изделий для позиций без изделия. Без apply — предложения, с apply — запись picks. */
  @Post(':id/match-products')
  @HttpCode(200)
  @Roles('admin', 'manager')
  @AuditAction({ action: 'salesorder.match-products', entityType: 'SalesOrder', idParam: 'id' })
  matchProducts(@Param('id') id: string, @Body() dto: MatchProductsDto) {
    return this.orders.matchProducts(id, dto.apply === true, dto.picks);
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
  @UseGuards(ConfirmTokenGuard)
  @Roles('admin', 'manager')
  @AuditAction({ action: 'salesorder.deleted', entityType: 'SalesOrder', idParam: 'id' })
  remove(@Param('id') id: string) {
    return this.orders.remove(id);
  }

  @Post(':id/restore')
  @UseGuards(ConfirmTokenGuard)
  @HttpCode(200)
  @Roles('admin', 'manager')
  @AuditAction({ action: 'salesorder.restored', entityType: 'SalesOrder', idParam: 'id' })
  restore(@Param('id') id: string) {
    return this.orders.restore(id);
  }
}
