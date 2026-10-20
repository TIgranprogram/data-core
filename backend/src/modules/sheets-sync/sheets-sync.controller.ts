import { Body, Controller, Delete, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AddSheetSourceDto } from './dto';
import { SheetsSyncService } from './sheets-sync.service';

/** Админка → «Google-таблицы»: какие таблицы сервер читает и кнопка «Синхронизировать сейчас». */
@ApiTags('admin')
@Controller('admin/sheets-sync')
export class SheetsSyncController {
  constructor(private readonly sync: SheetsSyncService) {}

  /** Статус: адрес сервисного аккаунта (им делятся таблицей), подключённые таблицы, итог последних запусков. */
  @Get()
  @Permissions('user:admin')
  @Roles('admin')
  status() {
    return this.sync.status();
  }

  /** Подключить таблицу по ссылке (сразу проверяет, что доступ у сервисного аккаунта есть). */
  @Post('sources')
  @Permissions('user:admin')
  @Roles('admin')
  add(@Body() dto: AddSheetSourceDto) {
    return this.sync.addSource(dto.url);
  }

  /** Отключить таблицу. Уже перенесённые записи остаются в базе. */
  @Delete('sources/:id')
  @Permissions('user:admin')
  @Roles('admin')
  remove(@Param('id') id: string) {
    return this.sync.removeSource(id);
  }

  @Post('run')
  @HttpCode(200)
  @Permissions('user:admin')
  @Roles('admin')
  run() {
    return this.sync.runAll();
  }
}
