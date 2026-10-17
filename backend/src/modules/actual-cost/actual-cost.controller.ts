import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
} from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { ActualCostService } from './actual-cost.service';
import { CreateActualCostDto } from './dto/create-actual-cost.dto';
import { AuditAction } from '../../common/decorators/audit-action.decorator';

@Controller('production-orders/:orderId/actual-costs')
export class ActualCostController {
  constructor(private readonly service: ActualCostService) {}

  @Get()
  findAll(@Param('orderId') orderId: string) {
    return this.service.findAll(orderId);
  }

  @Post()
  @Roles('admin', 'manager')
  @AuditAction({ action: 'create', entityType: 'ActualCost' })
  create(
    @Param('orderId') orderId: string,
    @Body() dto: CreateActualCostDto,
  ) {
    return this.service.create({ ...dto, orderId });
  }

  @Delete(':id')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'delete', entityType: 'ActualCost' })
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
