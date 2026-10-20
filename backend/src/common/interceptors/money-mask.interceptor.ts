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
    const req = context.switchToHttp().getRequest<{ user?: { role?: string; isOwner?: boolean }; body?: unknown }>();
    if (canSeeMoney(req.user)) return next.handle();
    if (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) {
      for (const k of MONEY_FIELDS) delete (req.body as Record<string, unknown>)[k];
    }
    return next.handle().pipe(map((data) => strip(data, 0)));
  }
}

function strip(v: unknown, depth: number): unknown {
  if (depth > 6 || v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map((x) => strip(x, depth + 1));
  if (v instanceof Date || (v as { _bsontype?: string })._bsontype) return v;
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    if (MONEY_FIELDS.includes(k)) continue;
    out[k] = strip(x, depth + 1);
  }
  return out;
}
