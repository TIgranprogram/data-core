import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiQuery, ApiTags } from '@nestjs/swagger';
import { AppSectionFree } from '../../common/decorators/app-section.decorator';
import { CurrentUser, type AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AssistantService } from './assistant.service';
import { ChatDto } from './dto/chat.dto';

/** Помощник «Рабочего места» (этап 1): вопросы по данным, только чтение, от имени пользователя. */
@ApiTags('Помощник')
@AppSectionFree()
@Controller('assistant')
export class AssistantController {
  constructor(private readonly assistant: AssistantService) {}

  @Post('chat')
  @Roles('user')
  chat(@Body() dto: ChatDto, @CurrentUser() user: AuthenticatedUser) {
    return this.assistant.chat(user, dto);
  }

  @Get('history')
  @Roles('user')
  @ApiQuery({ name: 'limit', required: false, description: 'Сообщений, 1–200 (по умолчанию 50)' })
  history(@CurrentUser() user: AuthenticatedUser, @Query('limit') limit?: string) {
    return this.assistant.history(user.id, Number(limit) || 50);
  }

  @Get('usage')
  @Roles('user')
  usage(@CurrentUser() user: AuthenticatedUser) {
    return this.assistant.usage(user);
  }
}
