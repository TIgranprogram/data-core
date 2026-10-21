import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseInterceptors } from '@nestjs/common';
import { ApiQuery, ApiTags } from '@nestjs/swagger';
import { AuditAction } from '../../common/decorators/audit-action.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { MoneyMaskInterceptor } from '../../common/interceptors/money-mask.interceptor';
import { PartnersService, type PartnerInput } from './partners.service';

/** «Контрагенты» приложения: поставщики / заказчики / наши компании, всё связанное, правка, объединение дублей. */
@ApiTags('Контрагенты')
@UseInterceptors(MoneyMaskInterceptor) // суммы — только админ / директор / бухгалтер
@Controller('partners')
export class PartnersController {
  constructor(private readonly partners: PartnersService) {}

  @Get()
  @Roles('user')
  @ApiQuery({ name: 'type', required: false, description: 'supplier (умолч.) | customer | our' })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'deleted', required: false, description: '1 — корзина (удалённые, все виды)' })
  list(@Query() q: Record<string, string>) {
    return this.partners.list(q);
  }

  /** «+ Новый контрагент»: kind supplier | customer | our, название, ИНН, КПП, адрес, телефон, почта, сайт, банк, контакт. */
  @Post()
  @Roles('manager')
  @AuditAction({ action: 'partner.created', entityType: 'Partner' })
  create(@Body() dto: PartnerInput) {
    return this.partners.create(dto ?? {});
  }

  /** id — организация (ObjectId) или заказчик `c:<название>` (encodeURIComponent). */
  @Get(':id')
  @Roles('user')
  get(@Param('id') id: string) {
    return this.partners.get(id);
  }

  @Patch(':id')
  @Roles('manager')
  @AuditAction({ action: 'partner.updated', entityType: 'Partner', details: (_d, p) => ({ id: p.id }) })
  update(@Param('id') id: string, @Body() dto: PartnerInput) {
    return this.partners.update(id, dto ?? {});
  }

  /** В корзину; занятого (заявки, заказы, записи CRM) — 409 с причиной. */
  @Delete(':id')
  @Roles('manager')
  @AuditAction({ action: 'partner.deleted', entityType: 'Partner', details: (_d, p) => ({ id: p.id }) })
  remove(@Param('id') id: string) {
    return this.partners.remove(id);
  }

  @Post(':id/restore')
  @HttpCode(200)
  @Roles('manager')
  @AuditAction({ action: 'partner.restored', entityType: 'Partner', details: (_d, p) => ({ id: p.id }) })
  restore(@Param('id') id: string) {
    return this.partners.restore(id);
  }

  @Post(':id/merge')
  @HttpCode(200)
  @Roles('manager')
  @AuditAction({ action: 'partner.merged', entityType: 'Partner', details: (_d, p) => ({ id: p.id }) })
  merge(@Param('id') id: string, @Body() body: { intoId?: string }) {
    return this.partners.merge(id, String(body?.intoId ?? ''));
  }
}
