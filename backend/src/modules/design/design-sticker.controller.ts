import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AppSection } from '../../common/decorators/app-section.decorator';
import { AuditAction } from '../../common/decorators/audit-action.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { DesignStickerDto } from './dto/design-task.dto';
import { DesignStickerService } from './design-sticker.service';

/** Стикеры доски проектирования: смотреть — роли доски, настраивать — только admin. */
@ApiTags('Проектирование')
@AppSection('design')
@Controller('design-stickers')
export class DesignStickerController {
  constructor(private readonly stickers: DesignStickerService) {}

  /** Все стикеры доски (и скрытые) по порядку — для настроек. */
  @Get()
  @Roles('admin', 'director', 'manager', 'user')
  list() {
    return this.stickers.list();
  }

  @Post()
  @Roles('admin')
  @AuditAction({ action: 'designsticker.created', entityType: 'DesignSticker' })
  create(@Body() dto: DesignStickerDto) {
    return this.stickers.create(dto);
  }

  @Patch(':id')
  @Roles('admin')
  @AuditAction({ action: 'designsticker.updated', entityType: 'DesignSticker', idParam: 'id' })
  update(@Param('id') id: string, @Body() dto: DesignStickerDto) {
    return this.stickers.update(id, dto);
  }

  @Delete(':id')
  @Roles('admin')
  @AuditAction({ action: 'designsticker.deleted', entityType: 'DesignSticker', idParam: 'id' })
  remove(@Param('id') id: string) {
    return this.stickers.remove(id);
  }
}
