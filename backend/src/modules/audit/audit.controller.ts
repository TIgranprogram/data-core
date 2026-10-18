import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuditService } from './audit.service';
import type { AuditQueryRaw } from './audit-query';

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

  @Get('facets')
  @Roles('admin')
  @ApiOperation({ summary: 'Значения для фильтров журнала: типы сущностей, действия, пользователи' })
  facets() {
    return this.service.facets();
  }
}
