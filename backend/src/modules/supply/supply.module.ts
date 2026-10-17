import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { SupplyTask, SupplyTaskSchema } from './supply-task.schema';
import { SupplyTaskController } from './supply-task.controller';
import { SupplyTaskService } from './supply-task.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: SupplyTask.name, schema: SupplyTaskSchema },
    ]),
  ],
  controllers: [SupplyTaskController],
  providers: [SupplyTaskService],
  exports: [SupplyTaskService, MongooseModule],
})
export class SupplyModule {}
