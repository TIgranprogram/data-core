import { Module } from '@nestjs/common';
import { AppDataController } from './app-data.controller';
import { AppDataService } from './app-data.service';
import { AppScopeGuard } from './app-scope.guard';

/**
 * P1 — `/api/apps/:app/:collection` — CRUD JSON-документов любого приложения
 * без кода на сервере. Регистрируется в app.module ДО EntityAttributeValueModule:
 * его маршрут `/:entityType/:entityId/attributes` иначе перехватил бы
 * `/apps/<app>/attributes`.
 */
@Module({
  controllers: [AppDataController],
  providers: [AppDataService, AppScopeGuard],
})
export class AppDataModule {}
