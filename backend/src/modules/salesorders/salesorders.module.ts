import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { SalesOrder, SalesOrderSchema } from './sales-order.schema';
import { AuditModule } from '../audit/audit.module';
import { IncomesModule } from '../incomes/incomes.module';
import { ZonesModule } from '../zones/zones.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ProductionOrdersController } from './production-orders.controller';
import { ProductionOrdersService } from './production-orders.service';
import { SalesOrdersController } from './salesorders.controller';
import { SalesOrdersService } from './salesorders.service';

/** /api/salesorders — заказы заказчиков (шапки); коллекция data-core `salesorders`. Позиции — `incomes`. */
@Module({
  imports: [MongooseModule.forFeature([{ name: SalesOrder.name, schema: SalesOrderSchema }]), AuditModule, NotificationsModule, ZonesModule, IncomesModule],
  controllers: [SalesOrdersController, ProductionOrdersController],
  providers: [SalesOrdersService, ProductionOrdersService],
  exports: [SalesOrdersService, ProductionOrdersService, MongooseModule],
})
export class SalesOrdersModule {}
