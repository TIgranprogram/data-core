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
import { Roles } from '../../common/decorators/roles.decorator';
import { AuthenticatedUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuditAction } from '../../common/interceptors/audit.interceptor';
import {
  CreateSupplyRequestDto,
  ReceiveSupplyRequestDto,
  UpdateSupplyRequestDto,
} from './dto/supply-request.dto';
import { SupplyRequestService } from './supply-request.service';

@Controller('supply-requests')
export class SupplyRequestController {
  constructor(private readonly service: SupplyRequestService) {}

  @Get()
  @Roles('admin', 'director', 'manager', 'user')
  list(
    @Query('status') status?: string,
    @Query('priority') priority?: string,
    @Query('search') search?: string,
    @Query('orderId') orderId?: string,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    return this.service.findAll({ status, priority, search, orderId }, user?.organizationId);
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
  @AuditAction({ action: 'create', entityType: 'SupplyRequest' })
  create(
    @Body() dto: CreateSupplyRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.create(dto, user.organizationId, undefined, user.id);
  }

  @Patch(':id')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'update', entityType: 'SupplyRequest', idParam: 'id' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateSupplyRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.update(id, dto, user.organizationId);
  }

  @Post(':id/ordered')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'ordered', entityType: 'SupplyRequest', idParam: 'id' })
  markOrdered(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.markOrdered(id, user.organizationId);
  }

  @Post(':id/receive')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'receive', entityType: 'SupplyRequest', idParam: 'id' })
  receive(
    @Param('id') id: string,
    @Body() dto: ReceiveSupplyRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.receive(id, dto, user.organizationId);
  }

  @Post(':id/cancel')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'cancel', entityType: 'SupplyRequest', idParam: 'id' })
  cancel(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.cancel(id, user.organizationId);
  }

  @Delete(':id')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'delete', entityType: 'SupplyRequest', idParam: 'id' })
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.remove(id, user.organizationId);
  }
}
