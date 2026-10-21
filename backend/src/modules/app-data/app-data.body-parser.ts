import type { INestApplication } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { json } from 'express';

/** Предел тела запроса для /api/apps (bulk до 500 документов); один документ — ≤256 КБ (проверка в сервисе). */
export const APP_DATA_BODY_LIMIT = '16mb';

/**
 * Стандартный JSON-парсер Nest режет тело на 100 КБ — меньше лимита документа.
 * Вызывать ДО app.init()/listen(): express-middleware встаёт раньше парсера Nest,
 * а тот пропускает уже разобранное тело.
 *
 * Обёртка с другим именем обязательна: Nest не ставит свой глобальный парсер, если
 * в стеке express уже есть слой с именем `jsonParser` — без обёртки все остальные
 * маршруты остались бы без разбора JSON.
 */
export function registerAppDataBodyParser(app: INestApplication): void {
  const parser = json({ limit: APP_DATA_BODY_LIMIT });
  app.use('/api/apps', function appDataJsonParser(req: Request, res: Response, next: NextFunction) {
    parser(req, res, next);
  });
}
