import { NestFactory } from '@nestjs/core';
import { SwaggerModule } from '@nestjs/swagger';
import { writeFileSync, mkdirSync } from 'fs';
import { dirname, resolve } from 'path';
import { AppModule } from './app.module';
import { buildSwaggerConfig } from './swagger.config';

/**
 * Экспорт статического OpenAPI (задача P1.6).
 *
 * Генерирует `docs/openapi.json` из ТЕХ ЖЕ декораторов, что и Swagger UI,
 * поэтому файл — эталон публичного контракта (его можно коммитить и отдавать
 * внешним интеграциям без включённого /docs).
 *
 * Запуск (внутри контейнера, т.к. нужен доступ к Mongo для старта AppModule):
 *   docker compose exec backend node dist/src/export-openapi.js [внешний/путь/openapi.json]
 */
async function main(): Promise<void> {
  const outArg = process.argv[2];
  const outPath = resolve(outArg ?? process.env.OPENAPI_OUT ?? 'openapi.json');

  const app = await NestFactory.create(AppModule, { logger: false });
  const document = SwaggerModule.createDocument(app, buildSwaggerConfig());

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(document, null, 2) + '\n', 'utf8');

  const paths = Object.keys(document.paths ?? {}).length;
  console.log(`openapi.json written: ${outPath} (${paths} paths)`);

  await app.close();
  process.exit(0);
}

main().catch((err) => {
  console.error('openapi export failed:', err);
  process.exit(1);
});
