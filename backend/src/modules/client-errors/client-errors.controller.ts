import { BadRequestException, Body, Controller, ForbiddenException, Get, HttpCode, Post, Query } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { ClientErrorsService } from './client-errors.service';
import { CreateClientErrorDto } from './dto/create-client-error.dto';

/**
 * ОШ2.1 — сбор ошибок приложения. Раздела (@AppSection) нет: ошибку присылает любой вошедший.
 */
@ApiTags('Ошибки клиента')
@Controller('client-errors')
export class ClientErrorsController {
  constructor(private readonly service: ClientErrorsService) {}

  /**
   * Любая роль. Ключ kppd_ — только kind=integration (лог ИИ/скрипта для разработчиков).
   * Сверх 20/мин — 204 без записи. Общий throttle здесь выключен.
   */
  @Post()
  @SkipThrottle({ short: true, long: true })
  @HttpCode(204)
  @Roles('admin', 'manager', 'user')
  @ApiOperation({ summary: 'Сообщить об ошибке в приложении или лог ИИ (kind=integration)' })
  @ApiResponse({ status: 204, description: 'Принято (сверх лимита 20/мин — молча не записано)' })
  @ApiResponse({ status: 400, description: 'Лишнее поле, нет message или неверный kind' })
  @ApiResponse({ status: 403, description: 'Ключ kppd_ с kind≠integration' })
  async create(@CurrentUser() me: AuthenticatedUser, @Body() dto: CreateClientErrorDto): Promise<void> {
    if (me.keyScope && dto.kind !== 'integration') {
      throw new ForbiddenException('Ключ kppd_ пишет только kind=integration (лог для разработчиков)');
    }
    const body = me.keyScope
      ? { ...dto, kind: 'integration' as const, section: dto.section || '#ai-agent', name: dto.name || 'AiAgent' }
      : dto;
    await this.service.record(body, { id: me.id, role: me.role });
  }

  @Get('top')
  @Roles('admin')
  @ApiOperation({ summary: 'Частые ошибки приложения за последние часы' })
  @ApiQuery({ name: 'hours', required: false, description: 'За сколько часов (по умолч. 24, макс. 720)' })
  @ApiQuery({ name: 'version', required: false, schema: { type: 'string', minLength: 1, maxLength: 40 }, description: 'Точное значение сохранённой версии. Отбор выполняется до группировки.' })
  @ApiResponse({ status: 200, description: '{ items: [{ sig, count, users, lastAt, message, name, section, action, url, status, version, sampleStack, kind }] } по убыванию count. При фильтре по версии ответ также содержит version на верхнем уровне.' })
  @ApiResponse({ status: 400, description: 'Параметр version должен быть одной непустой строкой до 40 символов' })
  top(@Query('hours') hours?: string, @Query('version') version?: unknown) {
    if (version !== undefined && (typeof version !== 'string' || !version.trim() || version.length > 40)) {
      throw new BadRequestException('Укажите одну непустую версию до 40 символов');
    }
    return this.service.top(hours, version);
  }
}
