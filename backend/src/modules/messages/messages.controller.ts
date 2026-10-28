import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser, type AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { SendMessageDto } from './dto/message.dto';
import { MessagesService } from './messages.service';

/** Мини-чат между сотрудниками. Переписки видны только участникам. */
@ApiTags('Сообщения')
@Controller('messages')
export class MessagesController {
  constructor(private readonly svc: MessagesService) {}

  @Get('users')
  @Roles('admin', 'director', 'manager', 'user', 'accountant')
  users(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.recipients(user);
  }

  @Get('threads')
  @Roles('admin', 'director', 'manager', 'user', 'accountant')
  threads(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.threads(user);
  }

  @Get('with/:userId')
  @Roles('admin', 'director', 'manager', 'user', 'accountant')
  with(@Param('userId') userId: string, @Query() q: Record<string, string>, @CurrentUser() user: AuthenticatedUser) {
    return this.svc.with(userId, q, user);
  }

  @Post('with/:userId/read')
  @HttpCode(200)
  @Roles('admin', 'director', 'manager', 'user', 'accountant')
  read(@Param('userId') userId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.svc.markRead(userId, user);
  }

  @Post()
  @Roles('admin', 'director', 'manager', 'user', 'accountant')
  send(@Body() dto: SendMessageDto, @CurrentUser() user: AuthenticatedUser) {
    return this.svc.send(dto, user);
  }
}
