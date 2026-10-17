import { Controller, Get, Query } from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuditService } from './audit.service';

@Controller('audit-logs')
export class AuditController {
  constructor(private readonly service: AuditService) {}

  @Get()
  @Roles('admin')
  list(
    @Query('entityType') entityType?: string,
    @Query('userId') userId?: string,
    @Query('action') action?: string,
    @Query('page') page = '1',
    @Query('limit') limit = '50',
  ) {
    return this.service.findAll(
      { entityType, userId, action },
      parseInt(page, 10),
      parseInt(limit, 10),
    );
  }
}
