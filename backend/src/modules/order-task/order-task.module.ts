import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { OrderTask, OrderTaskSchema } from './order-task.schema';
import { OrderTaskService } from './order-task.service';
import { OrderTaskController } from './order-task.controller';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: OrderTask.name, schema: OrderTaskSchema }]),
  ],
  controllers: [OrderTaskController],
  providers: [OrderTaskService],
  exports: [OrderTaskService, MongooseModule],
})
export class OrderTaskModule {}
