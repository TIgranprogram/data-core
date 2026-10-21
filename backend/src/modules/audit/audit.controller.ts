import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CurrentUser, type AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuditService } from './audit.service';
import type { AuditQueryRaw } from './audit-query';
import { withChanges } from './record-history';

/** Типы записей рабочего приложения, чью историю видят все роли. */
export const RECORD_HISTORY_TYPES = ['SupplyRequest', 'Material', 'StockMovement', 'Counterparty', 'Order', 'Income', 'SalesOrder', 'Partner', 'DictItem', 'Product'];
const canMoney = (u?: AuthenticatedUser) => u?.isOwner === true || ['admin', 'director', 'accountant'].includes(u?.role ?? '');

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
  async record(@Query('entityType') entityType: string, @Query('entityId') entityId: string, @CurrentUser() user?: AuthenticatedUser) {
    if (!RECORD_HISTORY_TYPES.includes(entityType)) throw new BadRequestException('История для этого типа записей недоступна');
    if (!entityId?.trim() || entityId.length > 300) throw new BadRequestException('Не указана запись');
    // «было → стало» по полям (И.1) — из соседних снимков; деньги — только деньги-ролям; сами снимки наружу не отдаём
    const items = withChanges(await this.service.recordLogs(entityType, entityId.trim()) as Array<Record<string, unknown>>, canMoney(user));
    return {
      items: items.map((d) => ({ action: d.action, userName: d.userName ?? null, createdAt: d.createdAt, changes: d.changes, first: d.first })),
      total: items.length,
    };
  }

  /** Общая история приложения (И.2): все изменения записей приложения — кто / раздел / даты. Директор и администратор. */
  @Get('app')
  @Roles('admin', 'director')
  @ApiOperation({ summary: 'История изменений приложения: кто, что, когда (сначала новые)' })
  @ApiQuery({ name: 'entityType', required: false, description: RECORD_HISTORY_TYPES.join(' | ') })
  @ApiQuery({ name: 'userId', required: false }) @ApiQuery({ name: 'from', required: false }) @ApiQuery({ name: 'to', required: false })
  @ApiQuery({ name: 'page', required: false }) @ApiQuery({ name: 'limit', required: false, description: '≤ 200, по умолчанию 50' })
  appHistory(@Query() raw: AuditQueryRaw) {
    return this.service.appLogs({ ...raw, action: undefined, entityId: undefined }, RECORD_HISTORY_TYPES);
  }

  @Get('app/users')
  @Roles('admin', 'director')
  appUsers() {
    return this.service.appUsers(RECORD_HISTORY_TYPES);
  }

  @Get('facets')
  @Roles('admin')
  @ApiOperation({ summary: 'Значения для фильтров журнала: типы сущностей, действия, пользователи' })
  facets() {
    return this.service.facets();
  }
}
