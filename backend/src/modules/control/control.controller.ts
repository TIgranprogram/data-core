import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { ControlService } from './control.service';
import { ControlRangeQuery, CreateRunDto } from './dto/control.dto';

/** «Состояние сайта»: показатели по дням и месяцам, приём ночных прогонов. Только admin. */
@ApiTags('Состояние сайта')
@Controller('control')
@Roles('admin')
export class ControlController {
  constructor(private readonly service: ControlService) {}

  @Get('catalog')
  @ApiOperation({ summary: 'Каталог показателей: ключ, подпись, группа, единица, есть ли источник' })
  @ApiResponse({ status: 200, description: '{ items:[{ key, label, group, groupLabel, unit, source, sourceNote, needs? }], total, page, limit, groups }' })
  catalog() {
    return this.service.catalog();
  }

  @Get('daily')
  @ApiOperation({ summary: 'Дневные точки показателей (до 400 дней). null = «нет данных», не 0' })
  @ApiResponse({ status: 200, description: '{ items:[{ date, m:{ключ:число|null}, schemaV, meta }], total, page, limit }' })
  daily(@Query() q: ControlRangeQuery) {
    return this.service.listDaily(q);
  }

  @Get('monthly')
  @ApiOperation({ summary: 'Месячные свёртки показателей (хранятся всегда): min/max/avg/last/n' })
  @ApiResponse({ status: 200, description: '{ items:[{ month, m:{ключ:{min,max,avg,last,n}}, days }], total, page, limit }' })
  monthly(@Query() q: ControlRangeQuery) {
    return this.service.listMonthly(q);
  }

  @Post('runs')
  @ApiOperation({ summary: 'Принять summary.json ночного прогона (повтор того же прогона заменяет запись)' })
  @ApiResponse({ status: 201, description: '{ id, created }' })
  ingestRun(@Body() dto: CreateRunDto) {
    return this.service.ingestRun(dto);
  }
}
