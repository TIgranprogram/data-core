/**
 * Публичный вход домена доходов (C255).
 * Новый код снаружи берёт модуль, фасад и операции записи отсюда.
 * Порт цикла `common/income-owner-port` читает `income-writes` напрямую: бочка с Nest-модулем вернёт цикл.
 */
export { IncomesModule } from './incomes.module';
export { IncomesService } from './incomes.service';
export { IncomeCancelService } from './income-cancel.service';
export * from './income-writes';
