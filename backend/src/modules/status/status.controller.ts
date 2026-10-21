import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { StatusService } from './status.service';

interface CreateStatusDto {
  entityType: string;
  statusId: string;
  label: string;
  color?: string;
  icon?: string;
  sortOrder?: number;
  isInitial?: boolean;
  isFinal?: boolean;
}

interface CreateWorkflowDto {
  entityType: string;
  name: string;
  statuses: string[];
  transitions: { fromStatus: string; toStatus: string; roles: string[] }[];
  isActive?: boolean;
}

@Controller()
export class StatusController {
  constructor(private readonly service: StatusService) {}

  // --- EntityStatus endpoints ---

  @Get('statuses/:entityType')
  @Roles('admin', 'manager')
  listStatuses(@Param('entityType') entityType: string) {
    return this.service.findStatuses(entityType);
  }

  @Post('statuses')
  @Roles('admin')
  createStatus(@Body() dto: CreateStatusDto) {
    return this.service.createStatus(dto);
  }

  @Put('statuses/:entityType/:statusId')
  @Roles('admin')
  updateStatus(
    @Param('entityType') entityType: string,
    @Param('statusId') statusId: string,
    @Body() dto: Partial<CreateStatusDto>,
  ) {
    return this.service.updateStatus(entityType, statusId, dto);
  }

  // --- StatusWorkflow endpoints ---

  @Get('workflows/:entityType')
  @Roles('admin', 'manager')
  listWorkflows(@Param('entityType') entityType: string) {
    return this.service.findWorkflows(entityType);
  }

  @Post('workflows')
  @Roles('admin')
  createWorkflow(@Body() dto: CreateWorkflowDto) {
    return this.service.createWorkflow(dto);
  }
}
