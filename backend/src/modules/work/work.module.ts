import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CounterModule } from '../counter/counter.module';
import { WorkRouteController } from './work-route.controller';
import { WorkRouteService } from './work-route.service';
import { WorkTask, WorkTaskSchema } from './work-task.schema';
import { WorkController } from './work.controller';
import { WorkService } from './work.service';

/** /api/work-tasks — «В работе»: карточки позиций заказов по шагам маршрута (`worktasks`); /api/work-routes — маршрут изделия (`products.workTypes`). */
@Module({
  imports: [MongooseModule.forFeature([{ name: WorkTask.name, schema: WorkTaskSchema }]), CounterModule],
  controllers: [WorkController, WorkRouteController],
  providers: [WorkService, WorkRouteService],
})
export class WorkModule {}
