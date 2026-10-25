import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CounterModule } from '../counter/counter.module';
import { DesignTask, DesignTaskSchema } from './design-task.schema';
import { DesignController } from './design.controller';
import { DesignService } from './design.service';

/** /api/design-tasks — «Проектирование»: задачи на чертежи под позиции заказов; коллекция `designtasks`. */
@Module({
  imports: [MongooseModule.forFeature([{ name: DesignTask.name, schema: DesignTaskSchema }]), CounterModule],
  controllers: [DesignController],
  providers: [DesignService],
})
export class DesignModule {}
