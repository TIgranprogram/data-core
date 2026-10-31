import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { READ_ONLY_MESSAGE, RETRY_AFTER_SEC, blockedWhenReadOnly, isSwitchPath, routePath } from './switch.rules';
import { SwitchService } from './switch.service';

/**
 * Режим «только чтение» на время переключения: запись → 503 READ_ONLY, чтение и вход работают.
 * Без HA_SELF — ничего не проверяет (кроме 404 на /control/switch: механизм выключен).
 * Решает по памяти (кэш обновляет таймер сервиса), к базе не обращается.
 */
@Injectable()
export class SwitchMiddleware implements NestMiddleware {
  constructor(private readonly sw: SwitchService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    if (!this.sw.enabled) {
      if (isSwitchPath(routePath(req.originalUrl || req.url))) {
        res.status(404).json({ statusCode: 404, message: 'Not Found' });
        return;
      }
      return next();
    }
    if (this.sw.isReadOnly() && blockedWhenReadOnly(req.method, routePath(req.originalUrl || req.url))) {
      res.setHeader('Retry-After', String(RETRY_AFTER_SEC));
      res.status(503).json({ statusCode: 503, code: 'READ_ONLY', message: READ_ONLY_MESSAGE, retryAfter: RETRY_AFTER_SEC });
      return;
    }
    next();
  }
}
