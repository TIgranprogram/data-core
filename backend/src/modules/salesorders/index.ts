/**
 * Публичный вход домена заказов (C255).
 * Новый код снаружи берёт модуль, фасады и операции записи отсюда.
 * Порты цикла читают `salesorder-writes` напрямую: бочка с Nest-модулем вернёт цикл.
 */
export { SalesOrdersModule } from './salesorders.module';
export { SalesOrdersService } from './salesorders.service';
export { ProductionOrdersService } from './production-orders.service';
export * from './salesorder-writes';
