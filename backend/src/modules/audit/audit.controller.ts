import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuditService } from './audit.service';
import type { AuditQueryRaw } from './audit-query';

/** Типы записей рабочего приложения, чью историю видят все роли. */
export const RECORD_HISTORY_TYPES = ['SupplyRequest', 'Material', 'StockMovement', 'Counterparty', 'Order', 'Income', 'SalesOrder'];

/**
 * Журнал аудита (только admin). Пишут оба приложения единой базы — data-core и kppdf.
 * A3: фильтры entityType / action / userId / entityId / from / to, страницы (limit ≤ 200),
 * details без секретов; /facets — значения для выпадающих фильтров админки.
 */
@ApiTags('audit')
@ApiBearerAuth()
@Controller('audit-logs')
export class AuditController {
  constructor(private readonly service: AuditService) {}

  @Get()
  @Roles('admin')
  @ApiOperation({ summary: 'Журнал изменений: кто, что и когда (сначала новые)' })
  @ApiQuery({ name: 'entityType', required: false })
  @ApiQuery({ name: 'action', required: false })
  @ApiQuery({ name: 'userId', required: false })
  @ApiQuery({ name: 'entityId', required: false })
  @ApiQuery({ name: 'from', required: false, description: 'YYYY-MM-DD или ISO' })
  @ApiQuery({ name: 'to', required: false, description: 'YYYY-MM-DD или ISO (включительно)' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false, description: '≤ 200, по умолчанию 50' })
  list(@Query() raw: AuditQueryRaw) {
    return this.service.findAll(raw);
  }

  /**
   * История одной записи рабочего приложения (карточка → «История»): кто и когда менял.
   * Доступна всем ролям, но только для типов записей приложения и без содержимого details.
   */
  @Get('record')
  @Roles('admin', 'director', 'manager', 'user')
  @ApiOperation({ summary: 'История одной записи (заявка, позиция склада, контрагент, заказ): кто, что, когда' })
  @ApiQuery({ name: 'entityType', required: true, description: RECORD_HISTORY_TYPES.join(' | ') })
  @ApiQuery({ name: 'entityId', required: true })
  async record(@Query('entityType') entityType: string, @Query('entityId') entityId: string) {
    if (!RECORD_HISTORY_TYPES.includes(entityType)) throw new BadRequestException('История для этого типа записей недоступна');
    const r = await this.service.findAll({ entityType, entityId, limit: '100' } as AuditQueryRaw);
    return {
      items: (r.items as Array<Record<string, unknown>>).map((d) => ({ action: d.action, userName: d.userName ?? null, createdAt: d.createdAt })),
      total: r.total,
    };
  }

  @Get('facets')
  @Roles('admin')
  @ApiOperation({ summary: 'Значения для фильтров журнала: типы сущностей, действия, пользователи' })
  facets() {
    return this.service.facets();
  }
}
