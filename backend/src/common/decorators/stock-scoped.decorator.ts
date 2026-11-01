import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import { getAuthenticatedUser } from './current-user.decorator';
import { stockScopeFor, type StockScope } from '../stock-scope';

/** Метка на обработчике: маршрут получает доступ к складам и обязан применить его (тест-перечень e2e ищет по ней). */
export const STOCK_SCOPED_KEY = 'stock:scoped';

const scopeParam = createParamDecorator((_d: unknown, ctx: ExecutionContext): StockScope | null => stockScopeFor(getAuthenticatedUser(ctx)));

/**
 * Параметр обработчика: доступ пользователя к складам (`null` — весь склад). Сервисы склада требуют его аргументом,
 * поэтому маршрут без `@StockScoped()` не может отдать позиции в обход складов.
 */
export function StockScoped(): ParameterDecorator {
  return (target, key, index) => {
    if (key) Reflect.defineMetadata(STOCK_SCOPED_KEY, true, (target as Record<string | symbol, object>)[key]);
    scopeParam()(target, key, index);
  };
}
