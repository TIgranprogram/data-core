import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AppSection } from '../../common/decorators/app-section.decorator';
import { AuditAction } from '../../common/decorators/audit-action.decorator';
import { CurrentUser, type AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { MyTaskActionDto } from './dto/my-task.dto';
import { MyTasksService } from './my-tasks.service';

/** «Мои задания» (C050): свои шаги плана без денег; начал / закончил / отложил / проблема мастеру. */
@ApiTags('Мои задания')
@AppSection('my-tasks')
@Controller('my-tasks')
export class MyTasksController {
  constructor(private readonly tasks: MyTasksService) {}

  /** Мои задания: `{ linked, items }`; `linked: false` — вход не привязан к сотруднику. */
  @Get()
  @Roles('user')
  list(@CurrentUser() user?: AuthenticatedUser) {
    return this.tasks.list(user?.id);
  }

  /** «Начал»: ставит начало (повтор не перезаписывает); снимает «Отложено». Второе одновременное — 409. */
  @Post(':planId/:stepId/start')
  @HttpCode(200)
  @Roles('user')
  @AuditAction({ action: 'mytask.start', entityType: 'OrderLinePlan', idParam: 'planId' })
  start(@Param('planId') planId: string, @Param('stepId') stepId: string, @Body() dto: MyTaskActionDto, @CurrentUser() user?: AuthenticatedUser) {
    return this.tasks.act(user?.id, planId, stepId, 'start', dto);
  }

  /** «Закончил»: ставит конец и пишет факт-часы (повтор не двоит). */
  @Post(':planId/:stepId/finish')
  @HttpCode(200)
  @Roles('user')
  @AuditAction({ action: 'mytask.finish', entityType: 'OrderLinePlan', idParam: 'planId' })
  finish(@Param('planId') planId: string, @Param('stepId') stepId: string, @Body() dto: MyTaskActionDto, @CurrentUser() user?: AuthenticatedUser) {
    return this.tasks.act(user?.id, planId, stepId, 'finish', dto);
  }

  /** «Отложить»: причина обязательна, `until` — на когда (пусто — завтра). */
  @Post(':planId/:stepId/defer')
  @HttpCode(200)
  @Roles('user')
  @AuditAction({ action: 'mytask.defer', entityType: 'OrderLinePlan', idParam: 'planId' })
  defer(@Param('planId') planId: string, @Param('stepId') stepId: string, @Body() dto: MyTaskActionDto, @CurrentUser() user?: AuthenticatedUser) {
    return this.tasks.act(user?.id, planId, stepId, 'defer', dto);
  }

  /** «Проблема мастеру»: причина обязательна. */
  @Post(':planId/:stepId/problem')
  @HttpCode(200)
  @Roles('user')
  @AuditAction({ action: 'mytask.problem', entityType: 'OrderLinePlan', idParam: 'planId' })
  problem(@Param('planId') planId: string, @Param('stepId') stepId: string, @Body() dto: MyTaskActionDto, @CurrentUser() user?: AuthenticatedUser) {
    return this.tasks.act(user?.id, planId, stepId, 'problem', dto);
  }
}
