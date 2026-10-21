import { Controller, Get, Query } from '@nestjs/common';
import { ApiQuery, ApiTags } from '@nestjs/swagger';
import { CurrentUser, type AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { FillAuditService } from './fill-audit.service';

/** «Требуют заполнения» по категориям (TASKS ТЗ): что не заполнено, зачем, куда идти. Денежные группы — только денежным ролям. */
@ApiTags('Требуют заполнения')
@Controller('fill-audit')
export class FillAuditController {
  constructor(private readonly audit: FillAuditService) {}

  @Get()
  @Roles('user')
  @ApiQuery({ name: 'limit', required: false, description: 'строк в группе (1–200, умолч. 30)' })
  @ApiQuery({ name: 'only', required: false, description: 'ключ одной группы, напр. exp-cost' })
  report(@CurrentUser() user: AuthenticatedUser, @Query('limit') limit?: string, @Query('only') only?: string) {
    return this.audit.report(user, { limit: Number(limit) || undefined, only });
  }
}
