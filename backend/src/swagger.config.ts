import { DocumentBuilder } from '@nestjs/swagger';

/**
 * Единая конфигурация OpenAPI (задача P1.6).
 *
 * Используется и в `main.ts` (Swagger UI на /docs), и в `export-openapi.ts`
 * (статический `docs/openapi.json` для репозитория) — чтобы UI и экспорт
 * гарантированно описывали один и тот же контракт.
 */
export function buildSwaggerConfig() {
  return new DocumentBuilder()
    .setTitle('Data Core API')
    .setDescription('Personal Data Core — MongoDB + REST API')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
}
