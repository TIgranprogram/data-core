import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseInterceptors } from '@nestjs/common';
import { MoneyMaskInterceptor } from '../../common/interceptors/money-mask.interceptor';
import { ApiQuery, ApiTags } from '@nestjs/swagger';
import { AuditAction } from '../../common/decorators/audit-action.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, type AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { SupplyPhotoDto, SupplyReceiveDto, SupplyRequestDto } from './dto';
import { SupplyService } from './supply.service';

/** Заявки снабжения на общей коллекции CRM `supplyrequests`. Роли — как в CRM kppdf. */
@ApiTags('Снабжение')
@UseInterceptors(MoneyMaskInterceptor) // суммы — только админ / директор / бухгалтер
@Controller('supply')
export class SupplyController {
  constructor(private readonly supply: SupplyService) {}

  @Get('requests')
  @Roles('admin', 'director', 'manager', 'user')
  @ApiQuery({ name: 'page', required: false }) @ApiQuery({ name: 'limit', required: false, description: '≤1000, по умолчанию 1000' })
  @ApiQuery({ name: 'search', required: false, description: 'наименование, артикул, заказчик, примечание, кто подал, № счёта, № заявки, поставщик' })
  @ApiQuery({ name: 'sort', required: false, description: 'num | requestDate | title | qty | priceHint | status | requestedBy | createdAt | updatedAt | deletedAt; «-» — по убыванию (умолч. -requestDate)' })
  @ApiQuery({ name: 'status', required: false, description: 'через запятую: in_progress, requested, ordered, paid, received, cancelled' })
  @ApiQuery({ name: 'supplierId', required: false }) @ApiQuery({ name: 'categoryId', required: false }) @ApiQuery({ name: 'materialId', required: false })
  @ApiQuery({ name: 'requestedBy', required: false }) @ApiQuery({ name: 'priority', required: false })
  @ApiQuery({ name: 'from', required: false, description: 'ГГГГ-ММ-ДД' }) @ApiQuery({ name: 'to', required: false, description: 'ГГГГ-ММ-ДД' })
  @ApiQuery({ name: 'deleted', required: false, description: '1 — только удалённые (корзина)' })
  list(@Query() q: Record<string, string>) {
    return this.supply.list(q);
  }

  /** Подсказки для формы и фильтров: поставщики, наши компании, категории, «кто подал». */
  @Get('lookups')
  @Roles('admin', 'director', 'manager', 'user')
  lookups() {
    return this.supply.lookups();
  }

  @Get('requests/:id')
  @Roles('admin', 'director', 'manager', 'user')
  get(@Param('id') id: string) {
    return this.supply.get(id);
  }

  @Post('requests')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'supply.request.created', entityType: 'SupplyRequest' })
  create(@Body() dto: SupplyRequestDto, @CurrentUser() user?: AuthenticatedUser) {
    return this.supply.create(dto, user?.id);
  }

  @Patch('requests/:id')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'supply.request.updated', entityType: 'SupplyRequest', idParam: 'id' })
  update(@Param('id') id: string, @Body() dto: SupplyRequestDto) {
    return this.supply.update(id, dto);
  }

  /** В корзину (мягкое удаление). */
  @Delete('requests/:id')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'supply.request.deleted', entityType: 'SupplyRequest', idParam: 'id' })
  remove(@Param('id') id: string) {
    return this.supply.remove(id);
  }

  /** Вернуть из корзины. */
  @Post('requests/:id/restore')
  @HttpCode(200)
  @Roles('admin', 'manager')
  @AuditAction({ action: 'supply.request.restored', entityType: 'SupplyRequest', idParam: 'id' })
  restore(@Param('id') id: string) {
    return this.supply.restore(id);
  }

  /** Добавить фото: photoId из POST /api/photos/upload (перетаскивание / вставка / файл). */
  @Post('requests/:id/photos')
  @HttpCode(200)
  @Roles('admin', 'manager')
  @AuditAction({ action: 'supply.request.photo.added', entityType: 'SupplyRequest', idParam: 'id' })
  addPhoto(@Param('id') id: string, @Body() dto: SupplyPhotoDto) {
    return this.supply.addPhoto(id, dto.photoId);
  }

  /** Убрать фото из заявки (сам файл остаётся в фотохранилище). */
  @Delete('requests/:id/photos/:photoId')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'supply.request.photo.removed', entityType: 'SupplyRequest', idParam: 'id' })
  removePhoto(@Param('id') id: string, @Param('photoId') photoId: string) {
    return this.supply.removePhoto(id, photoId);
  }

  /** Оприходовать на склад: приход + статус «Получено». */
  @Post('requests/:id/receive')
  @HttpCode(200)
  @Roles('admin', 'manager')
  @AuditAction({ action: 'supply.request.received', entityType: 'SupplyRequest', idParam: 'id' })
  receive(@Param('id') id: string, @Body() dto: SupplyReceiveDto, @CurrentUser() user?: AuthenticatedUser) {
    return this.supply.receive(id, dto, user?.id);
  }
}
