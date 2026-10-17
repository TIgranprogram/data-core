import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ActualCost, ActualCostSchema } from './actual-cost.schema';
import { ActualCostService } from './actual-cost.service';
import { ActualCostController } from './actual-cost.controller';
import { CostComparisonController } from './cost-comparison.controller';
import {
  CostCalculation,
  CostCalculationSchema,
} from '../cost-calculation/cost-calculation.schema';
import { ProductionOrderModule } from '../production-order/production-order.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ActualCost.name, schema: ActualCostSchema },
      { name: CostCalculation.name, schema: CostCalculationSchema },
    ]),
    ProductionOrderModule,
  ],
  controllers: [ActualCostController, CostComparisonController],
  providers: [ActualCostService],
  exports: [ActualCostService, MongooseModule],
})
export class ActualCostModule {}
