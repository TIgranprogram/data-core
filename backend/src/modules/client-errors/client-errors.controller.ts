import { Body, Controller, ForbiddenException, Get, HttpCode, Post, Query } from '@nestjs/common';
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
   * Любая роль (@Roles('user') по иерархии пропускает все). Ключ kppd_ → 403.
   * Сверх 20 в минуту от пользователя — тоже 204, но без записи (клиент не должен зацикливаться на 429).
   * Общий лимит (10/с, 100/мин) здесь не действует: пачка из очереди без сети не должна дать 429
   * и съесть запросы, которые человеку нужны для работы. Свой лимит — в сервисе.
   */
  @Post()
  @SkipThrottle({ short: true, long: true })
  @HttpCode(204)
  @Roles('admin', 'manager', 'user')
  @ApiOperation({ summary: 'Сообщить об ошибке в приложении (без данных форм)' })
  @ApiResponse({ status: 204, description: 'Принято (сверх лимита 20/мин — молча не записано)' })
  @ApiResponse({ status: 400, description: 'Лишнее поле, нет message или неверный kind' })
  @ApiResponse({ status: 403, description: 'Вход по ключу kppd_' })
  async create(@CurrentUser() me: AuthenticatedUser, @Body() dto: CreateClientErrorDto): Promise<void> {
    if (me.keyScope) {
      throw new ForbiddenException('Ошибки приложения принимаются только из входа в приложение');
    }
    await this.service.record(dto, { id: me.id, role: me.role });
  }

  @Get('top')
  @Roles('admin')
  @ApiOperation({ summary: 'Частые ошибки приложения за последние часы' })
  @ApiQuery({ name: 'hours', required: false, description: 'За сколько часов (по умолч. 24, макс. 720)' })
  @ApiResponse({ status: 200, description: '{ items: [{ sig, count, users, lastAt, message, name, section, action, url, status, version, sampleStack }] } по убыванию count' })
  top(@Query('hours') hours?: string) {
    return this.service.top(hours);
  }
}
