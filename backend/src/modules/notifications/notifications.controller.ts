import { Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiQuery, ApiTags } from '@nestjs/swagger';
import { CurrentUser, type AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { NotificationsService } from './notifications.service';

/** Уведомления текущего пользователя (колокольчик): «Важные» и «Система». */
@ApiTags('Уведомления')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly svc: NotificationsService) {}

  @Get()
  @Roles('admin', 'director', 'manager', 'user', 'accountant')
  @ApiQuery({ name: 'kind', required: false, description: 'important | system' })
  list(@Query() q: Record<string, string>, @CurrentUser() user: AuthenticatedUser) {
    return this.svc.list(q, user);
  }

  /** Объявлен до `:id`. Ответ: { important, system }. */
  @Get('unread')
  @Roles('admin', 'director', 'manager', 'user', 'accountant')
  unread(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.unread(user);
  }

  @Post('read-all')
  @HttpCode(200)
  @Roles('admin', 'director', 'manager', 'user', 'accountant')
  readAll(@Query() q: Record<string, string>, @CurrentUser() user: AuthenticatedUser) {
    return this.svc.readAll(q, user);
  }

  @Post(':id/read')
  @HttpCode(200)
  @Roles('admin', 'director', 'manager', 'user', 'accountant')
  read(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.svc.read(id, user);
  }
}
