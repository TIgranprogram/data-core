import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  ProductionOrder,
  ProductionOrderSchema,
} from './production-order.schema';
import { ProductionOrderService } from './production-order.service';
import { ProductionOrderController } from './production-order.controller';
import { CounterModule } from '../counter/counter.module';
import { Product, ProductSchema } from '../product/product.schema';
import { TechProcess, TechProcessSchema } from '../tech-process/tech-process.schema';
import { Bom, BomSchema } from '../bom/bom.schema';
import { OrderTask, OrderTaskSchema } from '../order-task/order-task.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ProductionOrder.name, schema: ProductionOrderSchema },
      { name: Product.name, schema: ProductSchema },
      { name: TechProcess.name, schema: TechProcessSchema },
      { name: Bom.name, schema: BomSchema },
      { name: OrderTask.name, schema: OrderTaskSchema },
    ]),
    CounterModule,
  ],
  controllers: [ProductionOrderController],
  providers: [ProductionOrderService],
  exports: [ProductionOrderService, MongooseModule],
})
export class ProductionOrderModule {}
