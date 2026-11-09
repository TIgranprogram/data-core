import { Module } from '@nestjs/common';
import { AppsController } from './apps.controller';
import { AppsService } from './apps.service';

/** /api/apps — приложения для скачивания (сейчас «Загрузка из PDM»). Файлы: `uploads/apps/pdm-loader/<версия>/`. */
@Module({ controllers: [AppsController], providers: [AppsService] })
export class AppsModule {}
