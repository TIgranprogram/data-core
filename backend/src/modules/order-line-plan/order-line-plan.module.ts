import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { OrderLinePlanController, WorkScheduleController } from './order-line-plan.controller';
import { OrderLinePlan, OrderLinePlanSchema } from './order-line-plan.schema';
import { OrderLinePlanService } from './order-line-plan.service';
import { WorkScheduleService } from './work-schedule.service';

/** /api/orderline-plans — план позиции заказа (части × виды работ, «Проверено»); коллекция orderlineplans. */
@Module({
  imports: [MongooseModule.forFeature([{ name: OrderLinePlan.name, schema: OrderLinePlanSchema }])],
  controllers: [OrderLinePlanController, WorkScheduleController],
  providers: [OrderLinePlanService, WorkScheduleService],
  exports: [OrderLinePlanService],
})
export class OrderLinePlanModule {}
