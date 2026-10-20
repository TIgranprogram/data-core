import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { SalesOrder, SalesOrderSchema } from './sales-order.schema';
import { SalesOrdersController } from './salesorders.controller';
import { SalesOrdersService } from './salesorders.service';

/** /api/salesorders — заказы заказчиков (шапки); коллекция data-core `salesorders`. Позиции — `incomes`. */
@Module({
  imports: [MongooseModule.forFeature([{ name: SalesOrder.name, schema: SalesOrderSchema }])],
  controllers: [SalesOrdersController],
  providers: [SalesOrdersService],
  exports: [SalesOrdersService, MongooseModule],
})
export class SalesOrdersModule {}
