import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { OrderTaskService } from './order-task.service';
import { CreateOrderTaskDto } from './dto/create-order-task.dto';
import { UpdateOrderTaskDto } from './dto/update-order-task.dto';
import { AuditAction } from '../../common/decorators/audit-action.decorator';

@Controller('order-tasks')
export class OrderTaskController {
  constructor(private readonly service: OrderTaskService) {}

  @Get()
  findAll(
    @Query('productionOrderId') productionOrderId?: string,
    @Query('status') status?: string,
  ) {
    return this.service.findAll(productionOrderId, status);
  }

  @Get('ready')
  findReady(@Query('workerId') workerId?: string) {
    return this.service.findReady(workerId);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findById(id);
  }

  @Post()
  @Roles('admin', 'manager')
  @AuditAction({ action: 'create', entityType: 'OrderTask' })
  create(@Body() dto: CreateOrderTaskDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'update', entityType: 'OrderTask' })
  update(@Param('id') id: string, @Body() dto: UpdateOrderTaskDto) {
    return this.service.update(id, dto);
  }

  @Post(':id/complete')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'complete', entityType: 'OrderTask' })
  complete(@Param('id') id: string, @Body() body?: { actualHours?: number }) {
    return this.service.complete(id, body?.actualHours);
  }

  @Delete(':id')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'delete', entityType: 'OrderTask' })
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
