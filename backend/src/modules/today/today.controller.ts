import { Controller, Get, Query } from '@nestjs/common';
import { ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser, type AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { TodayService } from './today.service';

/** «Сегодня»: лента дел, неделя и показатели одним запросом. Только чтение; чего роль не видит — нет в ответе. */
@ApiTags('Сегодня')
@Controller('today')
export class TodayController {
  constructor(private readonly today: TodayService) {}

  @Get()
  @Roles('admin', 'director', 'manager', 'user', 'accountant')
  @ApiQuery({ name: 'scope', required: false, description: 'mine | all — «Моё / Всё» (по умолчанию: зоны человека; Руководство и вход без сотрудника — all)' })
  @ApiQuery({ name: 'days', required: false, description: 'Горизонт недели, 1–31 (по умолчанию 7)' })
  get(@Query() q: { days?: string; scope?: string }, @CurrentUser() user: AuthenticatedUser) {
    return this.today.get(user, q);
  }
}

/** Числа на пунктах меню одним запросом; разделы, закрытые роли, в ответе отсутствуют. */
@ApiTags('Сегодня')
@Controller('me')
export class MeCountersController {
  constructor(private readonly today: TodayService) {}

  @Get('counters')
  @Roles('admin', 'director', 'manager', 'user', 'accountant')
  @ApiResponse({ status: 200, description: '{ requests, stockLow, awaiting, salesorders, design, work } — числа; ключ закрытого раздела отсутствует' })
  counters(@CurrentUser() user: AuthenticatedUser) {
    return this.today.counters(user);
  }
}
