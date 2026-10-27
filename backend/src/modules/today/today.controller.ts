import { Controller, Get, Query } from '@nestjs/common';
import { ApiQuery, ApiTags } from '@nestjs/swagger';
import { AppSection } from '../../common/decorators/app-section.decorator';
import { CurrentUser, type AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { TodayService } from './today.service';

/** «Сегодня»: лента дел, неделя и показатели одним запросом. Только чтение; чего роль не видит — нет в ответе. */
@ApiTags('Сегодня')
@AppSection('home')
@Controller('today')
export class TodayController {
  constructor(private readonly today: TodayService) {}

  @Get()
  @Roles('admin', 'director', 'manager', 'user', 'accountant')
  @ApiQuery({ name: 'days', required: false, description: 'Горизонт недели, 1–31 (по умолчанию 7)' })
  get(@Query() q: { days?: string }, @CurrentUser() user: AuthenticatedUser) {
    return this.today.get(user, q);
  }
}
