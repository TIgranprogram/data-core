/**
 * Публичный вход домена изделий (C255).
 * Новый код снаружи берёт модуль, фасад и операции записи отсюда.
 * Порт витрины `common/product-owner-port` читает `product-writes` напрямую: бочка с Nest-модулем вернёт цикл.
 */
export { ProductModule } from './product.module';
export { ProductService } from './product.service';
export * from './product-writes';
