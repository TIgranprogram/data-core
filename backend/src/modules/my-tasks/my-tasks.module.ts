import { Module } from '@nestjs/common';
import { OrderLinePlanModule } from '../order-line-plan/order-line-plan.module';
import { MyTasksController } from './my-tasks.controller';
import { MyTasksService } from './my-tasks.service';

/** /api/my-tasks — «Мои задания» рабочего: свои шаги планов (`orderlineplans.steps[]`), без денег (C050). */
@Module({
  imports: [OrderLinePlanModule],
  controllers: [MyTasksController],
  providers: [MyTasksService],
})
export class MyTasksModule {}
