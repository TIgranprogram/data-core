import { Body, Controller, Delete, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AppSection } from '../../common/decorators/app-section.decorator';
import { AuditAction } from '../../common/decorators/audit-action.decorator';
import { CurrentUser, type AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AddDesignOrderDto } from './dto/design-task.dto';
import { DesignBoardService } from './design-board.service';

/**
 * Доска проектирования: слева заказы, справа задачи по статусам. Смотреть — роли с разделом «Проектирование»,
 * добавлять и убирать заказ — admin и manager. Цен и сумм в ответах нет.
 */
@ApiTags('Проектирование')
@AppSection('design')
@Controller('design-board')
export class DesignBoardController {
  constructor(private readonly board: DesignBoardService) {}

  /** Один запрос при открытии доски: заказы (кап 200), счётчики, открытые задачи (кап 500). В базу ничего не пишет. */
  @Get()
  @Roles('admin', 'director', 'manager', 'user')
  get() {
    return this.board.board();
  }

  @Get(':orderId/lines')
  @Roles('admin', 'director', 'manager', 'user')
  lines(@Param('orderId') orderId: string) {
    return this.board.lines(orderId);
  }

  /** Повтор безопасен: заказ уже на доске — 200 без ошибки. */
  @Post()
  @HttpCode(200)
  @Roles('admin', 'manager')
  @AuditAction({ action: 'designboard.added', entityType: 'DesignOrder' })
  add(@Body() dto: AddDesignOrderDto, @CurrentUser() user?: AuthenticatedUser) {
    return this.board.addOrder(dto, user?.id);
  }

  @Delete(':orderId')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'designboard.removed', entityType: 'DesignOrder', idParam: 'orderId' })
  remove(@Param('orderId') orderId: string) {
    return this.board.removeOrder(orderId);
  }
}
