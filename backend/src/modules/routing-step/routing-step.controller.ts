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
import { RoutingStepService } from './routing-step.service';
import { CreateRoutingStepDto } from './dto/create-routing-step.dto';
import { UpdateRoutingStepDto } from './dto/update-routing-step.dto';
import { AuditAction } from '../../common/decorators/audit-action.decorator';

@Controller('routing-steps')
export class RoutingStepController {
  constructor(private readonly service: RoutingStepService) {}

  @Get()
  findAll(
    @Query('workshop') workshop?: string,
    @Query('workTypeId') workTypeId?: string,
    @Query('isActive') isActive?: string,
  ) {
    const active =
      isActive === undefined ? undefined : isActive === 'true' || isActive === '1';
    return this.service.findAll(workshop, workTypeId, active);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findById(id);
  }

  @Get(':id/expanded')
  expanded(@Param('id') id: string) {
    return this.service.findById(id);
  }

  @Post()
  @Roles('admin', 'manager')
  @AuditAction({ action: 'create', entityType: 'RoutingStep' })
  create(@Body() dto: CreateRoutingStepDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'update', entityType: 'RoutingStep' })
  update(@Param('id') id: string, @Body() dto: UpdateRoutingStepDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'delete', entityType: 'RoutingStep' })
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
