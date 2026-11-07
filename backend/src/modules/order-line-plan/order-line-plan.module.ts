import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ShowcaseModule } from '../showcase/showcase.controller';
import { OrderLinePlanController, WorkScheduleController } from './order-line-plan.controller';
import { OrderLinePlan, OrderLinePlanSchema } from './order-line-plan.schema';
import { OrderLinePlanService } from './order-line-plan.service';
import { WorkFactsController } from './work-facts.controller';
import { WorkFactsService } from './work-facts.service';
import { WorkScheduleService } from './work-schedule.service';

/** /api/orderline-plans — план позиции заказа (части × виды работ, «Проверено»); /api/work-facts — факт, нормы, себестоимость (C041 Э3). */
@Module({
  imports: [MongooseModule.forFeature([{ name: OrderLinePlan.name, schema: OrderLinePlanSchema }]), ShowcaseModule],
  controllers: [OrderLinePlanController, WorkScheduleController, WorkFactsController],
  providers: [OrderLinePlanService, WorkScheduleService, WorkFactsService],
  exports: [OrderLinePlanService, WorkFactsService],
})
export class OrderLinePlanModule {}
