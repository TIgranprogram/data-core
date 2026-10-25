import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CounterModule } from '../counter/counter.module';
import { DesignBoardController } from './design-board.controller';
import { DesignBoardService } from './design-board.service';
import { DesignOrder, DesignOrderSchema } from './design-order.schema';
import { DesignTask, DesignTaskSchema } from './design-task.schema';
import { DesignController } from './design.controller';
import { DesignService } from './design.service';

/** /api/design-tasks — «Проектирование»: задачи на чертежи под позиции заказов (`designtasks`); /api/design-board — доска заказов (`designorders`). */
@Module({
  imports: [MongooseModule.forFeature([{ name: DesignTask.name, schema: DesignTaskSchema }, { name: DesignOrder.name, schema: DesignOrderSchema }]), CounterModule],
  controllers: [DesignController, DesignBoardController],
  providers: [DesignService, DesignBoardService],
})
export class DesignModule {}
