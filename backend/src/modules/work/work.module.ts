import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CounterModule } from '../counter/counter.module';
import { AuditModule } from '../audit/audit.module';
import { OrderLinePlanModule } from '../order-line-plan/order-line-plan.module';
import { WorkRouteController } from './work-route.controller';
import { WorkRouteService } from './work-route.service';
import { WorkTask, WorkTaskSchema } from './work-task.schema';
import { WorkController } from './work.controller';
import { WorkService } from './work.service';
import { WorkMediaController } from './work-media.controller';
import { WorkMediaService } from './work-media.service';
import { WorkNote, WorkNoteSchema } from './work-note.schema';

/** /api/work-tasks — «В работе»: карточки позиций заказов по шагам маршрута (`worktasks`); /api/work-routes — маршрут изделия (`products.workTypes`). */
@Module({
  imports: [MongooseModule.forFeature([{ name: WorkTask.name, schema: WorkTaskSchema }, { name: WorkNote.name, schema: WorkNoteSchema }]), CounterModule, OrderLinePlanModule, AuditModule],
  controllers: [WorkController, WorkRouteController, WorkMediaController],
  providers: [WorkService, WorkRouteService, WorkMediaService],
})
export class WorkModule {}
