import { Body, Controller, Get, Headers, HttpCode, Post, Req } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { Public } from '../../../common/decorators/public.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { EmergencySwitchDto, StartSwitchDto, SwitchReportDto } from './switch.dto';
import { SwitchService } from './switch.service';

/** «Переключить сейчас»: какой сервер главный, запуск переключения. Без HA_SELF в .env все маршруты отвечают 404. */
@ApiTags('Переключение сервера')
@Controller('control/switch')
export class SwitchController {
  constructor(private readonly service: SwitchService) {}

  @Get()
  @Roles('admin')
  @ApiOperation({ summary: 'Состояние переключения: кто главный, режим, работа, готовность второго сервера' })
  @ApiResponse({ status: 200, description: '{ enabled, self:home|office, role:main|standby, mode:normal|readonly, job:{id,direction,step,state,startedAt,finishedAt?,error?}|null, peer:{name,version,copyAgeMin,healthy,checkedAt}, bridge:{alive}, canStart, canEmergency }' })
  @ApiResponse({ status: 404, description: 'Механизм выключен (нет HA_SELF)' })
  status() {
    return this.service.status();
  }

  @Post('start')
  @Roles('admin')
  @ApiOperation({ summary: 'Переключить сейчас: главным станет второй сервер. Повтор, пока идёт работа, — 409' })
  @ApiResponse({ status: 201, description: '{ ok:true, job }; дальше экран опрашивает GET /control/switch раз в 2–3 с' })
  @ApiResponse({ status: 409, description: 'Переключение уже идёт или этот сервер не главный' })
  @ApiResponse({ status: 503, description: 'Мост переключения не запущен' })
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- тело нужно только для проверки confirm
  start(@Body() _dto: StartSwitchDto) {
    return this.service.start();
  }

  @Post('emergency')
  @Roles('admin')
  @ApiOperation({ summary: 'Аварийный подъём запасного сервера на последних данных (основной не отвечает). Только role=standby' })
  @ApiResponse({ status: 201, description: '{ ok:true, job }' })
  @ApiResponse({ status: 409, description: 'Этот сервер уже главный или работа уже идёт' })
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- тело нужно только для проверки фразы
  emergency(@Body() _dto: EmergencySwitchDto) {
    return this.service.emergency();
  }

  @Post('report')
  @Public()
  @HttpCode(200)
  @ApiOperation({ summary: 'Служебный: отчёт хост-моста о шаге. Только с самого сервера и по секрету из файла' })
  @ApiHeader({ name: 'X-Switch-Secret', required: true })
  @ApiResponse({ status: 200, description: '{ ok, role, mode, job }' })
  @ApiResponse({ status: 403, description: 'Нет секрета, неверный секрет или запрос пришёл через прокси' })
  report(@Body() dto: SwitchReportDto, @Headers('x-switch-secret') secret: string | undefined, @Req() req: Request) {
    // через nginx/туннель приходит X-Forwarded-For; мост ходит на localhost без него
    const viaProxy = !!(req.headers['x-forwarded-for'] || req.headers['x-real-ip']);
    return this.service.report(dto, secret, viaProxy);
  }
}
