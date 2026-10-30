import { CallHandler, ExecutionContext, HttpException, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, finalize, tap } from 'rxjs';
import { latency } from './latency-histogram';

/**
 * А4 (2026-10-26): запросы дольше 1 с — в память (последние 300), без коллекции и без данных запроса.
 * Сводка по маршрутам — GET /api/health/slow (админ / директор, modules/disk). После перезапуска — пусто.
 * CC-11: тот же проход заодно увеличивает счётчик-гистограмму (`latency-histogram.ts`) — без записи в базу.
 */
export const SLOW_MS = 1000;
const MAX = 300;
export interface SlowHit { route: string; ms: number; at: number }
const hits: SlowHit[] = [];

export function recordSlow(route: string, ms: number, at = Date.now()) {
  if (ms < SLOW_MS) return;
  hits.push({ route, ms, at });
  if (hits.length > MAX) hits.splice(0, hits.length - MAX);
}

/** Сводка: маршрут → сколько раз, максимум и среднее, когда последний; самые частые сверху. */
export function slowSummary() {
  const by = new Map<string, { route: string; count: number; maxMs: number; sum: number; last: number }>();
  for (const h of hits) {
    const r = by.get(h.route) ?? { route: h.route, count: 0, maxMs: 0, sum: 0, last: 0 };
    r.count++; r.maxMs = Math.max(r.maxMs, h.ms); r.sum += h.ms; r.last = Math.max(r.last, h.at);
    by.set(h.route, r);
  }
  return {
    thresholdMs: SLOW_MS,
    items: [...by.values()].sort((a, b) => b.count - a.count || b.maxMs - a.maxMs)
      .map(({ sum, last, ...r }) => ({ ...r, avgMs: Math.round(sum / r.count), last: new Date(last) })),
  };
}

@Injectable()
export class SlowRequestInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (ctx.getType() !== 'http') return next.handle();
    const http = ctx.switchToHttp();
    const req = http.getRequest<{ method: string; route?: { path?: string }; path?: string }>();
    const t0 = Date.now();
    let failed: number | null = null;
    // маршрут шаблоном (/stock/items/:id), не адресом — без id и параметров
    return next.handle().pipe(
      // ошибка в обработчике: фильтр выставит код позже, поэтому берём его из самого исключения
      tap({ error: (e: unknown) => { failed = e instanceof HttpException ? e.getStatus() : 500; } }),
      finalize(() => {
        const ms = Date.now() - t0;
        recordSlow(`${req.method} ${req.route?.path ?? req.path ?? '?'}`, ms);
        latency.observe(ms, failed ?? http.getResponse<{ statusCode?: number }>()?.statusCode ?? 200);
      }),
    );
  }
}
