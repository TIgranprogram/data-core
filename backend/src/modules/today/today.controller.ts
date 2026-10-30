import { Controller, Get, Query, Header } from '@nestjs/common';
import { DataVersionService } from '../../common/data-version/data-version.service';
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

/** Раздел приложения → коллекции, чьи изменения он показывает. */
const VERSION_GROUPS = {
  requests: ['supplyrequests', 'supplyinvoices'], stock: ['materials', 'storageitems', 'stockmovements', 'reservations', 'categories'], money: ['incomes'],
  salesorders: ['salesorders', 'productionorders', 'shipments'], design: ['designtasks', 'designnotes'], work: ['worktasks'], passports: ['productpassports'], products: ['products'], users: ['users'],
} as const;

/** Числа на пунктах меню одним запросом; разделы, закрытые роли, в ответе отсутствуют. */
@ApiTags('Сегодня')
@Controller('me')
export class MeCountersController {
  constructor(private readonly today: TodayService, private readonly versions: DataVersionService) {}

  /** Обновление без F5 (СМ.9): версии разделов из памяти, к базе не обращается. Клиент спрашивает раз в 20 с. */
  @Get('versions')
  @Header('Cache-Control', 'no-store')
  @Roles('admin', 'director', 'manager', 'user', 'accountant')
  @ApiResponse({ status: 200, description: '{ live, epoch, v: { раздел: число } } — изменилось число, значит изменились данные раздела' })
  liveVersions() {
    return this.versions.snapshot(VERSION_GROUPS);
  }

  @Get('counters')
  @Roles('admin', 'director', 'manager', 'user', 'accountant')
  @ApiResponse({ status: 200, description: '{ requests, stockLow, awaiting, salesorders, design, work } — числа; ключ закрытого раздела отсутствует' })
  counters(@CurrentUser() user: AuthenticatedUser) {
    return this.today.counters(user);
  }
}
