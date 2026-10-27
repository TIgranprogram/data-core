import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { map, type Observable } from 'rxjs';
import { canSeeMoney, MONEY_FIELDS } from '../roles-hierarchy';

/**
 * Деньги — только администратору, директору и бухгалтеру (common/roles-hierarchy.ts).
 * Для остальных: из тела запроса денежные поля убираются (сумму не впишешь), из ответа — тоже (не увидишь).
 * Вешается на контроллеры заявок, заказов и позиций заказов (@UseInterceptors(MoneyMaskInterceptor)).
 */
@Injectable()
export class MoneyMaskInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<{ user?: { role?: string; isOwner?: boolean }; body?: unknown; query?: Record<string, unknown> }>();
    if (canSeeMoney(req.user)) return next.handle();
    if (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) {
      for (const k of MONEY_FIELDS) delete (req.body as Record<string, unknown>)[k];
    }
    // Статус оплаты — тоже деньги (решение пользователя 2026-10-24): фильтр «оплачено / ждём оплату / без суммы» → «отгружено»,
    // сортировка по денежному полю (сумма, дата оплаты, дата в отчёт) — не применяется.
    const q = req.query;
    if (q) {
      if (typeof q.status === 'string' && PAY_STATUS.has(q.status)) q.status = 'shipped';
      if (typeof q.sort === 'string' && MONEY_FIELDS.includes(q.sort.replace(/^-/, ''))) delete q.sort;
    }
    return next.handle().pipe(map((data) => strip(data, 0)));
  }
}

/** Статусы позиций заказа, по которым видно оплату (incomes.service `status`); для роли без денег — «отгружено». */
const PAY_STATUS = new Set(['paid', 'awaiting', 'noamount']);

function strip(v: unknown, depth: number): unknown {
  if (depth > 6 || v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map((x) => strip(x, depth + 1));
  if (v instanceof Date || (v as { _bsontype?: string })._bsontype) return v;
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    if (MONEY_FIELDS.includes(k)) continue;
    if (k === 'status' && typeof x === 'string' && PAY_STATUS.has(x)) { out[k] = 'shipped'; continue; }
    if (k === 'counts' && x && typeof x === 'object' && 'awaiting' in (x as object) && 'paid' in (x as object)) {
      const c = x as Record<string, number>;
      out[k] = { all: c.all, draft: c.draft, shipped: (c.paid ?? 0) + (c.awaiting ?? 0) + (c.noamount ?? 0) };
      continue;
    }
    out[k] = strip(x, depth + 1);
  }
  return out;
}

/** Убрать денежные поля из любых данных (помощник: инструменты читают сервисы напрямую, мимо интерцептора). */
export const stripMoney = (v: unknown): unknown => strip(v, 0);
