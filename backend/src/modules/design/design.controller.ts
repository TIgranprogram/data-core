import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiQuery, ApiTags } from '@nestjs/swagger';
import { AppSection } from '../../common/decorators/app-section.decorator';
import { AuditAction } from '../../common/decorators/audit-action.decorator';
import { CurrentUser, type AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { DesignTaskDto, FromOrderDto, PhotoDto, StickerValuesDto } from './dto/design-task.dto';
import { DesignExtrasService } from './design-extras.service';
import { DesignService } from './design.service';

/**
 * «Проектирование» (ПРЖ-3): задачи на чертежи. Смотреть — роли с разделом «Проектирование»,
 * создавать, назначать, двигать и удалять — admin и manager. Цен и сумм в ответах нет.
 */
@ApiTags('Проектирование')
@AppSection('design')
@Controller('design-tasks')
export class DesignController {
  constructor(private readonly design: DesignService, private readonly extras: DesignExtrasService) {}

  @Get()
  @Roles('admin', 'director', 'manager', 'user')
  @ApiQuery({ name: 'page', required: false }) @ApiQuery({ name: 'limit', required: false, description: 'до 500 (умолч. 100)' })
  @ApiQuery({ name: 'status', required: false, description: 'queue | work | done | paused, через запятую' })
  @ApiQuery({ name: 'assigneeId', required: false }) @ApiQuery({ name: 'orderId', required: false })
  @ApiQuery({ name: 'search', required: false, description: 'название, D-N, № заказа, заказчик, изделие, артикул' })
  @ApiQuery({ name: 'sort', required: false, description: 'seq | completedAt | createdAt; «-» — по убыванию (умолч. seq; status=done — по completedAt убыв.)' })
  @ApiQuery({ name: 'needsAnswer', required: false, description: '1 — только задачи с открытым вопросом менеджеру' })
  @ApiQuery({ name: 'deleted', required: false, description: '1 — корзина' })
  list(@Query() q: Record<string, string>) {
    return this.design.list(q);
  }

  /** Объявлен до `:id`. */
  @Post('from-order')
  @HttpCode(200)
  @Roles('admin', 'manager')
  @AuditAction({ action: 'designtask.from-order', entityType: 'DesignTask' })
  fromOrder(@Body() dto: FromOrderDto, @CurrentUser() user?: AuthenticatedUser) {
    return this.design.fromOrder(dto, user?.id);
  }

  @Get(':id')
  @Roles('admin', 'director', 'manager', 'user')
  get(@Param('id') id: string) {
    return this.design.get(id);
  }

  @Post()
  @Roles('admin', 'manager')
  @AuditAction({ action: 'designtask.created', entityType: 'DesignTask' })
  create(@Body() dto: DesignTaskDto, @CurrentUser() user?: AuthenticatedUser) {
    return this.design.create(dto, user?.id);
  }

  @Patch(':id')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'designtask.updated', entityType: 'DesignTask', idParam: 'id' })
  update(@Param('id') id: string, @Body() dto: DesignTaskDto, @CurrentUser() user?: AuthenticatedUser) {
    return this.design.update(id, dto, user?.id);
  }

  /** Фото задачи: photoId из POST /api/photos/upload. user — только своя или ничья задача. */
  @Post(':id/photos')
  @HttpCode(200)
  @Roles('admin', 'manager', 'user')
  @AuditAction({ action: 'designtask.photo.added', entityType: 'DesignTask', idParam: 'id' })
  addPhoto(@Param('id') id: string, @Body() dto: PhotoDto, @CurrentUser() user?: AuthenticatedUser) {
    return this.extras.addPhoto(id, dto.photoId, user);
  }

  @Delete(':id/photos/:photoId')
  @Roles('admin', 'manager', 'user')
  @AuditAction({ action: 'designtask.photo.removed', entityType: 'DesignTask', idParam: 'id' })
  removePhoto(@Param('id') id: string, @Param('photoId') photoId: string, @CurrentUser() user?: AuthenticatedUser) {
    return this.extras.removePhoto(id, photoId, user);
  }

  /** Значения своих стикеров точечно; null / "" — очистить. */
  @Patch(':id/stickers')
  @Roles('admin', 'manager', 'user')
  @AuditAction({ action: 'designtask.stickers.updated', entityType: 'DesignTask', idParam: 'id' })
  setStickers(@Param('id') id: string, @Body() dto: StickerValuesDto, @CurrentUser() user?: AuthenticatedUser) {
    return this.extras.setStickers(id, dto.values, user);
  }

  @Delete(':id')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'designtask.deleted', entityType: 'DesignTask', idParam: 'id' })
  remove(@Param('id') id: string) {
    return this.design.remove(id);
  }

  @Post(':id/restore')
  @HttpCode(200)
  @Roles('admin', 'manager')
  @AuditAction({ action: 'designtask.restored', entityType: 'DesignTask', idParam: 'id' })
  restore(@Param('id') id: string) {
    return this.design.restore(id);
  }
}
