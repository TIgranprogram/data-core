import { AppSection, AppSectionFree } from '../../common/decorators/app-section.decorator';
import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseInterceptors } from '@nestjs/common';
import { MoneyMaskInterceptor } from '../../common/interceptors/money-mask.interceptor';
import { ApiQuery, ApiTags } from '@nestjs/swagger';
import { AuditAction } from '../../common/decorators/audit-action.decorator';
import { CurrentUser, type AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { canSeeMoney } from '../../common/roles-hierarchy';
import { IncomeDto, PaymentDto } from './dto';
import { IncomesService } from './incomes.service';

/** Доходы — строки заказов (лист «Заказы»). Смотреть — все роли, менять — admin и manager (как снабжение). */
@ApiTags('Доходы (заказы)')
@UseInterceptors(MoneyMaskInterceptor) // суммы — только админ / директор / бухгалтер
@AppSection('orders', 'salesorders')
@Controller('incomes')
export class IncomesController {
  constructor(private readonly incomes: IncomesService) {}

  @Get()
  @Roles('admin', 'director', 'manager', 'user')
  @ApiQuery({ name: 'page', required: false }) @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'search', required: false, description: '№ заказа, заказчик, наименование, примечание, вид, цвет' })
  @ApiQuery({ name: 'sort', required: false, description: 'lineNo | orderNo | customer | title | qty | unitPrice | amount | shipDate | paidDate | reportDate | createdAt; «-» — по убыванию (умолч. -reportDate)' })
  @ApiQuery({ name: 'status', required: false, description: 'draft (не отгружено) | awaiting (отгружено, ждём оплату) | partial (оплачено частично) | paid' })
  @ApiQuery({ name: 'companyId', required: false }) @ApiQuery({ name: 'orderNo', required: false })
  @ApiQuery({ name: 'orderId', required: false, description: 'позиции заказа (salesorders), id через запятую' })
  @ApiQuery({ name: 'from', required: false, description: 'по дате в отчёт (оплаты, иначе отгрузки), ГГГГ-ММ-ДД' }) @ApiQuery({ name: 'to', required: false })
  @ApiQuery({ name: 'deleted', required: false, description: '1 — корзина' })
  list(@Query() q: Record<string, string>, @CurrentUser() user?: AuthenticatedUser) {
    return this.incomes.list(q, canSeeMoney(user));
  }

  /** Подсказки формы: наши компании, заказчики, формы оплаты. */
  @AppSectionFree()
  @Get('lookups')
  @Roles('admin', 'director', 'manager', 'user')
  lookups() {
    return this.incomes.lookups();
  }

  @Get(':id')
  @Roles('admin', 'director', 'manager', 'user')
  get(@Param('id') id: string) {
    return this.incomes.get(id);
  }

  @Post()
  @Roles('admin', 'manager')
  @AuditAction({ action: 'income.created', entityType: 'Income' })
  create(@Body() dto: IncomeDto, @CurrentUser() user?: AuthenticatedUser) {
    return this.incomes.create(dto, user?.id, user);
  }

  @Patch(':id')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'income.updated', entityType: 'Income', idParam: 'id' })
  update(@Param('id') id: string, @Body() dto: IncomeDto, @CurrentUser() user?: AuthenticatedUser) {
    return this.incomes.update(id, dto, user);
  }

  @Delete(':id')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'income.deleted', entityType: 'Income', idParam: 'id' })
  remove(@Param('id') id: string, @CurrentUser() user?: AuthenticatedUser) {
    return this.incomes.remove(id, user);
  }

  /** Фото позиции: photoId из POST /api/photos/upload (перетаскивание / вставка / файл в карточке). */
  @Post(':id/photos')
  @HttpCode(200)
  @Roles('admin', 'manager')
  @AuditAction({ action: 'income.photo.added', entityType: 'Income', idParam: 'id' })
  addPhoto(@Param('id') id: string, @Body() body: { photoId?: string }) {
    return this.incomes.addPhoto(id, String(body?.photoId ?? ''));
  }

  @Delete(':id/photos/:photoId')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'income.photo.removed', entityType: 'Income', idParam: 'id' })
  removePhoto(@Param('id') id: string, @Param('photoId') photoId: string) {
    return this.incomes.removePhoto(id, photoId);
  }

  /** Принять платёж по позиции (частичная оплата). */
  @Post(':id/payments')
  @HttpCode(200)
  @Roles('admin', 'manager')
  @AuditAction({ action: 'income.payment.added', entityType: 'Income', idParam: 'id' })
  addPayment(@Param('id') id: string, @Body() dto: PaymentDto, @CurrentUser() user?: AuthenticatedUser) {
    return this.incomes.addPayment(id, dto, user);
  }

  /** Убрать платёж по номеру в списке (0 — первый). */
  @Delete(':id/payments/:index')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'income.payment.removed', entityType: 'Income', idParam: 'id' })
  removePayment(@Param('id') id: string, @Param('index') index: string, @CurrentUser() user?: AuthenticatedUser) {
    return this.incomes.removePayment(id, Number(index), user);
  }

  @Post(':id/restore')
  @HttpCode(200)
  @Roles('admin', 'manager')
  @AuditAction({ action: 'income.restored', entityType: 'Income', idParam: 'id' })
  restore(@Param('id') id: string, @CurrentUser() user?: AuthenticatedUser) {
    return this.incomes.restore(id, user);
  }
}
