import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from './common/decorators/public.decorator';

/**
 * GET /api — корень API: короткая справка вместо 404, когда базовый адрес открывают в браузере.
 * Публичный, ничего не раскрывает: только куда идти дальше. Пути относительные — за nginx
 * базовый адрес содержит префикс (/db/api), его клиент знает сам.
 */
@Public()
@ApiTags('health')
@Controller()
export class ApiRootController {
  @Get()
  @ApiOperation({ summary: 'Справка по API (что это и куда идти дальше)' })
  root() {
    return {
      name: 'Data Core API',
      status: 'ok',
      message:
        'Это базовый адрес API единой базы данных. Сам по себе он ничего не возвращает — к нему дописывают путь, например /materials. Нужен ключ kppd_… (выдаётся в админке).',
      auth: 'Authorization: Bearer <ключ kppd_…>',
      next: {
        'health/ready': 'проверка, что сервер жив (без ключа)',
        'meta/guide': 'инструкция по подключению для разработчика и ИИ (с ключом)',
        'meta/schema': 'таблицы и поля базы (с ключом)',
        'meta/openapi.json': 'полный контракт API (с ключом)',
        'apps/<приложение>/<коллекция>': 'данные своего приложения: GET/POST/PATCH/PUT/DELETE (с ключом)',
      },
      admin: 'админка — тот же адрес, но /admin/ вместо /api (вкладка «Подключение»)',
    };
  }
}
