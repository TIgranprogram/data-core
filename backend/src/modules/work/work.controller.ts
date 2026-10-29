import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiQuery, ApiTags } from '@nestjs/swagger';
import { AppSection } from '../../common/decorators/app-section.decorator';
import { AuditAction } from '../../common/decorators/audit-action.decorator';
import { CurrentUser, type AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CancelDto, LaunchDto, MoveDto, WorkTaskPatchDto } from './dto/work.dto';
import { WorkService } from './work.service';

/**
 * «В работе»: карточки позиций заказов по шагам маршрута изделия. Смотреть — роли с разделом «В работе»,
 * запускать, двигать, назначать и удалять — admin и manager (мастер/менеджер, не рабочий с телефона). Цен и сумм нет.
 */
@ApiTags('В работе')
@AppSection('work')
@Controller('work-tasks')
export class WorkController {
  constructor(private readonly work: WorkService) {}

  @Get()
  @Roles('admin', 'director', 'manager', 'user')
  @ApiQuery({ name: 'page', required: false }) @ApiQuery({ name: 'limit', required: false, description: 'до 500 (умолч. 200)' })
  @ApiQuery({ name: 'status', required: false, description: 'waiting | work | done | cancelled, через запятую (умолч. все, кроме cancelled)' })
  @ApiQuery({ name: 'workTypeId', required: false, description: 'колонка доски: id вида работ текущего шага или generic («Изготовление»)' })
  @ApiQuery({ name: 'orderId', required: false }) @ApiQuery({ name: 'assigneeId', required: false })
  @ApiQuery({ name: 'search', required: false, description: 'W-N, № заказа, заказчик, изделие, артикул' })
  @ApiQuery({ name: 'doneDays', required: false, description: 'готовые старше N дней с доски убираются (умолч. 7; 0 — все)' })
  @ApiQuery({ name: 'sort', required: false, description: 'seq | completedAt | createdAt; «-» — по убыванию' })
  @ApiQuery({ name: 'deleted', required: false, description: '1 — корзина' })
  list(@Query() q: Record<string, string>) {
    return this.work.list(q);
  }

  /** Кого назначить: работающие сотрудники, с `workTypeId` — только с этим видом работ. Объявлен до `:id`. */
  @Get('people')
  @Roles('admin', 'director', 'manager', 'user')
  @ApiQuery({ name: 'workTypeId', required: false })
  people(@Query() q: Record<string, string>) {
    return this.work.people(q);
  }

  /** «Запустить в работу»: позиции без изделия и уже запущенные не запускаются — список причин в `refused`. */
  @Post('launch')
  @HttpCode(200)
  @Roles('admin', 'manager')
  @AuditAction({ action: 'worktask.launched', entityType: 'WorkTask' })
  launch(@Body() dto: LaunchDto, @CurrentUser() user?: AuthenticatedUser) {
    return this.work.launch(dto, user?.id);
  }

  @Get(':id')
  @Roles('admin', 'director', 'manager', 'user')
  get(@Param('id') id: string) {
    return this.work.get(id);
  }

  /** Перевод на шаг (`stepIndex`), следующий или «Ждёт запуска» (`to`). */
  @Post(':id/move')
  @HttpCode(200)
  @Roles('admin', 'manager')
  @AuditAction({ action: 'worktask.moved', entityType: 'WorkTask', idParam: 'id' })
  move(@Param('id') id: string, @Body() dto: MoveDto, @CurrentUser() user?: AuthenticatedUser) {
    return this.work.move(id, dto, user?.id);
  }

  @Post(':id/done')
  @HttpCode(200)
  @Roles('admin', 'manager')
  @AuditAction({ action: 'worktask.done', entityType: 'WorkTask', idParam: 'id' })
  done(@Param('id') id: string, @CurrentUser() user?: AuthenticatedUser) {
    return this.work.finish(id, user?.id);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @Roles('admin', 'manager')
  @AuditAction({ action: 'worktask.cancelled', entityType: 'WorkTask', idParam: 'id' })
  cancel(@Param('id') id: string, @Body() dto: CancelDto, @CurrentUser() user?: AuthenticatedUser) {
    return this.work.cancel(id, dto, user?.id);
  }

  @Patch(':id')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'worktask.updated', entityType: 'WorkTask', idParam: 'id' })
  update(@Param('id') id: string, @Body() dto: WorkTaskPatchDto) {
    return this.work.patch(id, dto);
  }

  @Delete(':id')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'worktask.deleted', entityType: 'WorkTask', idParam: 'id' })
  remove(@Param('id') id: string) {
    return this.work.remove(id);
  }

  @Post(':id/restore')
  @HttpCode(200)
  @Roles('admin', 'manager')
  @AuditAction({ action: 'worktask.restored', entityType: 'WorkTask', idParam: 'id' })
  restore(@Param('id') id: string) {
    return this.work.restore(id);
  }
}
