import { Controller, Get, Header, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Connection } from 'mongoose';
import { describeModels, MetaCollection } from './meta-schema';
import { META_GUIDE } from './meta-guide';

/** Хранит OpenAPI-документ, собранный в main.ts (тот же, что для Swagger UI). */
@Injectable()
export class MetaService {
  private openApi: unknown = null;
  setOpenApi(doc: unknown): void {
    this.openApi = doc;
  }
  getOpenApi(): unknown {
    return this.openApi;
  }
}

/**
 * Самоописание API для клиентов и ИИ-агентов. Доступно любому авторизованному
 * (JWT или ключ kppd_, в т.ч. read-only): ничего не меняет и не раскрывает секретов.
 */
@ApiTags('meta')
@ApiBearerAuth()
@Controller('meta')
export class MetaController {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    private readonly meta: MetaService,
  ) {}

  @Get('schema')
  @ApiOperation({ summary: 'Таблицы и поля базы (из моделей), без секретных полей' })
  schema(): { collections: MetaCollection[]; appsHint: string } {
    return {
      collections: describeModels(this.connection),
      appsHint: 'Данные приложений (app_<app>_<collection>) — GET /apps и /apps/<app>/<collection>',
    };
  }

  @Get('openapi.json')
  @ApiOperation({ summary: 'Полный контракт API (OpenAPI 3)' })
  openapi(): unknown {
    const doc = this.meta.getOpenApi();
    if (!doc) throw new NotFoundException('OpenAPI ещё не собран');
    return doc;
  }

  @Get('guide')
  @Header('Content-Type', 'text/markdown; charset=utf-8')
  @ApiOperation({ summary: 'Инструкция по подключению для ИИ-агента (markdown)' })
  guide(): string {
    return META_GUIDE;
  }
}
