import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, UseInterceptors } from '@nestjs/common';
import { ApiQuery, ApiTags } from '@nestjs/swagger';
import { AuditAction } from '../../common/decorators/audit-action.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { MoneyMaskInterceptor } from '../../common/interceptors/money-mask.interceptor';
import { PartnersService } from './partners.service';

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
  list(@Query() q: Record<string, string>) {
    return this.partners.list(q);
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
  update(@Param('id') id: string, @Body() dto: { name?: string; inn?: string; email?: string; phone?: string; website?: string; notes?: string }) {
    return this.partners.update(id, dto ?? {});
  }

  @Post(':id/merge')
  @HttpCode(200)
  @Roles('manager')
  @AuditAction({ action: 'partner.merged', entityType: 'Partner', details: (_d, p) => ({ id: p.id }) })
  merge(@Param('id') id: string, @Body() body: { intoId?: string }) {
    return this.partners.merge(id, String(body?.intoId ?? ''));
  }
}
