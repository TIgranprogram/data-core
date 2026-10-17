import { Controller, Get, Param } from '@nestjs/common';
import { ActualCostService } from './actual-cost.service';

@Controller('production-orders/:orderId')
export class CostComparisonController {
  constructor(private readonly service: ActualCostService) {}

  @Get('cost-comparison')
  costComparison(@Param('orderId') orderId: string) {
    return this.service.costComparison(orderId);
  }
}
