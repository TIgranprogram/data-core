import { Controller, Delete, Get, Param } from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { RateLimitService } from './rate-limit.service';
import { AuditAction } from '../../common/decorators/audit-action.decorator';

@Controller('rate-limits')
export class RateLimitController {
  constructor(private readonly service: RateLimitService) {}

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Delete(':key')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'clear', entityType: 'RateLimit' })
  clear(@Param('key') key: string) {
    return this.service.clear(key);
  }

  @Delete()
  @Roles('admin', 'manager')
  @AuditAction({ action: 'clear_all', entityType: 'RateLimit' })
  clearAll() {
    return this.service.clearAll();
  }
}
