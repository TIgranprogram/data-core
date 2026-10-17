import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  WorkOrderOperation,
  WorkOrderOperationSchema,
} from './work-order-operation.schema';
import { WorkOrderOperationService } from './work-order-operation.service';
import { WorkOrderOperationController } from './work-order-operation.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: WorkOrderOperation.name, schema: WorkOrderOperationSchema },
    ]),
  ],
  controllers: [WorkOrderOperationController],
  providers: [WorkOrderOperationService],
  exports: [WorkOrderOperationService, MongooseModule],
})
export class WorkOrderOperationModule {}
