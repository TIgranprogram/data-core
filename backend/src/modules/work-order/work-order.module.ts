import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { WorkOrder, WorkOrderSchema } from './work-order.schema';
import { WorkOrderService } from './work-order.service';
import { WorkOrderController } from './work-order.controller';
import { CounterModule } from '../counter/counter.module';
import {
  WorkOrderOperation,
  WorkOrderOperationSchema,
} from '../work-order-operation/work-order-operation.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: WorkOrder.name, schema: WorkOrderSchema },
      { name: WorkOrderOperation.name, schema: WorkOrderOperationSchema },
    ]),
    CounterModule,
  ],
  controllers: [WorkOrderController],
  providers: [WorkOrderService],
  exports: [WorkOrderService, MongooseModule],
})
export class WorkOrderModule {}
