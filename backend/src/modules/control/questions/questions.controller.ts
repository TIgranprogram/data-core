import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser, type AuthenticatedUser } from '../../../common/decorators/current-user.decorator';
import { Permissions } from '../../../common/decorators/permissions.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { AnswerDto, CreateQuestionDto, EventsQuery, PreviewDto, QuestionsQuery } from '../dto/questions.dto';
import { QuestionsService } from './questions.service';

const actorOf = (u: AuthenticatedUser) => ({ id: u.id, role: u.role, name: u.username, isOwner: u.isOwner });

/** «Разбор»: вопросы к человеку. Читает и отвечает только admin; ставить вопрос может ключ с правом `control:write`. */
@ApiTags('Разбор')
@Controller('control/questions')
@Roles('admin')
export class QuestionsController {
  constructor(private readonly service: QuestionsService) {}

  @Get()
  @ApiOperation({ summary: 'Список вопросов: сначала важные и просроченные. Фильтры status (через запятую), severity, type' })
  @ApiResponse({ status: 200, description: '{ items:[вопрос], total, page, limit, counts:{статус:число}, types:[{type,title}] }' })
  list(@Query() q: QuestionsQuery) {
    return this.service.list(q);
  }

  @Post()
  @Roles('user')
  @Permissions('control:write')
  @ApiOperation({ summary: 'Поставить вопрос (ИИ/скрипт с ПК). Лимит: 20 новых в сутки на источник, 200 открытых; сверх — один сводный' })
  @ApiResponse({ status: 201, description: '{ id, created, overflow }' })
  create(@Body() dto: CreateQuestionDto, @CurrentUser() u: AuthenticatedUser) {
    return this.service.create(dto, actorOf(u));
  }

  @Get(':id')
  @ApiOperation({ summary: 'Один вопрос' })
  get(@Param('id') id: string) {
    return this.service.get(id);
  }

  @Post(':id/preview')
  @HttpCode(200)
  @ApiOperation({ summary: 'Предпросмотр действия: что изменится и хеш плана (planHash) для подтверждения' })
  @ApiResponse({ status: 200, description: '{ questionId, optionCode, label, risk, reversible, lines:[текст], planHash }' })
  preview(@Param('id') id: string, @Body() dto: PreviewDto) {
    return this.service.preview(id, dto);
  }

  @Post(':id/answer')
  @HttpCode(200)
  @ApiOperation({ summary: 'Ответить: действие (с planHash), «Не проблема», «Отложить» (snoozeUntil), ответ текстом. Другой план — 409 с новым предпросмотром' })
  @ApiResponse({ status: 200, description: 'Вопрос после ответа' })
  answer(@Param('id') id: string, @Body() dto: AnswerDto, @CurrentUser() u: AuthenticatedUser) {
    return this.service.answer(id, dto, actorOf(u));
  }

  @Post(':id/undo')
  @HttpCode(200)
  @ApiOperation({ summary: 'Отменить выполненное действие, если затронутые записи не менялись после него' })
  undo(@Param('id') id: string, @CurrentUser() u: AuthenticatedUser) {
    return this.service.undo(id, actorOf(u));
  }

  @Get(':id/events')
  @ApiOperation({ summary: 'Журнал вопроса: кто, что и когда' })
  @ApiResponse({ status: 200, description: '{ items:[{ id, at, by, kind, before, after, note, data }], total, page, limit }' })
  events(@Param('id') id: string, @Query() q: EventsQuery) {
    return this.service.events(id, q);
  }
}
