import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { OrderClosing, OrderClosingSchema } from './order-closing.schema';
import { OrderClosingService } from './order-closing.service';
import { OrderClosingController } from './order-closing.controller';
import { OrderTask, OrderTaskSchema } from '../order-task/order-task.schema';
import { ProductionOrderModule } from '../production-order/production-order.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: OrderClosing.name, schema: OrderClosingSchema },
      { name: OrderTask.name, schema: OrderTaskSchema },
    ]),
    ProductionOrderModule,
  ],
  controllers: [OrderClosingController],
  providers: [OrderClosingService],
  exports: [OrderClosingService, MongooseModule],
})
export class OrderClosingModule {}
