import { Body, Controller, Get, Headers, HttpCode, Post, Req } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { Public } from '../../../common/decorators/public.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { EmergencySwitchDto, StartSwitchDto, SwitchReportDto } from './switch.dto';
import { SwitchService } from './switch.service';

/** «Переключить сейчас»: какой сервер главный, запуск переключения. Без HA_SELF в .env GET / и /ping — обзор (enabled:false, blockers), остальные маршруты 404. */
@ApiTags('Переключение сервера')
@Controller('control/switch')
export class SwitchController {
  constructor(private readonly service: SwitchService) {}

  @Get()
  @Roles('admin')
  @ApiOperation({ summary: 'Состояние переключения: кто главный, режим, работа, готовность второго сервера' })
  @ApiResponse({ status: 200, description: '{ enabled, self:home|office, version, autoRefresh:{enabled,minutes,lastAt}, role:main|standby, mode:normal|readonly, job:{id,direction,step,state,startedAt,finishedAt?,error?}|null, peer:{name,version,copyAgeMin,healthy,checkedAt}, bridge:{alive}, blockers:[строки], canStart, canRefresh, canEmergency, speed:{home,office}:{p50,p95,requests,slow,probeMs} }; version — сборка этого сервера (из pwa/version.json), версии соседа и своей сравниваются: разные — blockers и canStart=false (C042-A5); autoRefresh — авто-«Обновить» копии на главном (C042-A3). direction=refresh, пока идёт обновление запасного. canRefresh = главный + обычный режим + нет работы + мост жив (blockers не входят). Без HA_SELF — enabled:false и обзор соседа по HA_PEER_URL. speed не меняет переключение.' })
  
  status() {
    return this.service.status();
  }

  @Get('ping')
  @Public()
  @ApiOperation({ summary: 'Служебный: короткая справка для второго сервера — роль, версия, время копии. Без данных' })
  @ApiResponse({ status: 200, description: '{ self:home|office|null, role:main|standby|null, version, copyAt, speed:{p50,p95,requests,slow} }' })
  ping() {
    return this.service.ping();
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

  @Post('refresh')
  @Roles('admin')
  @ApiOperation({ summary: 'Обновить запасной: код и база, без смены домена. Повтор, пока идёт работа, — 409' })
  @ApiResponse({ status: 201, description: '{ ok:true, job }; direction=refresh' })
  @ApiResponse({ status: 409, description: 'Уже идёт работа или этот сервер не главный' })
  @ApiResponse({ status: 503, description: 'Мост переключения не запущен' })
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- тело нужно только для проверки confirm
  refresh(@Body() _dto: StartSwitchDto) {
    return this.service.refreshPeer();
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
