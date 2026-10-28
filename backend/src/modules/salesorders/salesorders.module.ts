import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { SalesOrder, SalesOrderSchema } from './sales-order.schema';
import { AuditModule } from '../audit/audit.module';
import { ProductionOrdersController } from './production-orders.controller';
import { ProductionOrdersService } from './production-orders.service';
import { SalesOrdersController } from './salesorders.controller';
import { SalesOrdersService } from './salesorders.service';

/** /api/salesorders — заказы заказчиков (шапки); коллекция data-core `salesorders`. Позиции — `incomes`. */
@Module({
  imports: [MongooseModule.forFeature([{ name: SalesOrder.name, schema: SalesOrderSchema }]), AuditModule],
  controllers: [SalesOrdersController, ProductionOrdersController],
  providers: [SalesOrdersService, ProductionOrdersService],
  exports: [SalesOrdersService, MongooseModule],
})
export class SalesOrdersModule {}
