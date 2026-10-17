import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuditAction } from '../../common/interceptors/audit.interceptor';
import {
  CreateSupplyTaskDto,
  ExplodeSupplyTasksDto,
  UpdateSupplyTaskDto,
} from './dto/create-supply-task.dto';
import { SupplyTaskService } from './supply-task.service';

@Controller('supply-tasks')
export class SupplyTaskController {
  constructor(private readonly service: SupplyTaskService) {}

  @Get()
  @Roles('admin', 'director', 'manager', 'user')
  list(
    @Query('orderId') orderId?: string,
    @Query('status') status?: string,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    return this.service.findAll({ orderId, status }, user?.organizationId);
  }

  @Post('explode')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'explode', entityType: 'SupplyTask' })
  explode(
    @Body() dto: ExplodeSupplyTasksDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.explode(dto, user.organizationId);
  }

  @Get(':id')
  @Roles('admin', 'director', 'manager', 'user')
  findOne(
    @Param('id') id: string,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    return this.service.findById(id, user?.organizationId);
  }

  @Post()
  @Roles('admin', 'manager')
  @AuditAction({ action: 'create', entityType: 'SupplyTask' })
  create(
    @Body() dto: CreateSupplyTaskDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.create(dto, user.organizationId);
  }

  @Patch(':id')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'update', entityType: 'SupplyTask', idParam: 'id' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateSupplyTaskDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.update(id, dto, user.organizationId);
  }

  @Post(':id/confirm')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'confirm', entityType: 'SupplyTask', idParam: 'id' })
  confirm(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.confirm(id, user.id, user.organizationId);
  }

  @Post(':id/unconfirm')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'unconfirm', entityType: 'SupplyTask', idParam: 'id' })
  unconfirm(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.unconfirm(id, user.organizationId);
  }

  @Post(':id/ordered')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'ordered', entityType: 'SupplyTask', idParam: 'id' })
  markOrdered(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.markOrdered(id, user.organizationId);
  }

  @Post(':id/received')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'received', entityType: 'SupplyTask', idParam: 'id' })
  markReceived(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.markReceived(id, user.organizationId);
  }

  @Delete(':id')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'delete', entityType: 'SupplyTask', idParam: 'id' })
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.remove(id, user.organizationId);
  }
}
