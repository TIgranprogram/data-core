import { Module } from '@nestjs/common';
import { SheetsSyncController } from './sheets-sync.controller';
import { SheetsSyncService } from './sheets-sync.service';

/** Чтение Google-таблиц сервером (сервисный аккаунт) → /api/apps/supply|warehouse. */
@Module({
  controllers: [SheetsSyncController],
  providers: [SheetsSyncService],
})
export class SheetsSyncModule {}
