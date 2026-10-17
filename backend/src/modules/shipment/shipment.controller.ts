import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseInterceptors,
} from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuthenticatedUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { ShipmentService } from './shipment.service';
import { CreateShipmentDto } from './dto/create-shipment.dto';
import { UpdateShipmentDto } from './dto/update-shipment.dto';
import { AddDocDto } from './dto/add-doc.dto';
import { AuditAction } from '../../common/decorators/audit-action.decorator';
import { RequireOrgScope } from '../../common/decorators/require-org-scope.decorator';
import { OrgScopeGuardInterceptor } from '../../common/interceptors/org-scope.interceptor';

@RequireOrgScope()
@UseInterceptors(OrgScopeGuardInterceptor)
@Controller('shipments')
export class ShipmentController {
  constructor(private readonly service: ShipmentService) {}

  @Get()
  findAll(
    @Query('orderId') orderId?: string,
    @Query('status') status?: string,
    @Query('date') date?: string,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    return this.service.findAll(orderId, status, date ? new Date(date) : undefined, user?.organizationId);
  }

  @Get(':id')
  findOne(
    @Param('id') id: string,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    return this.service.findById(id, user?.organizationId);
  }

  @Post()
  @Roles('admin', 'manager')
  @AuditAction({ action: 'create', entityType: 'Shipment' })
  create(
    @Body() dto: CreateShipmentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.create(dto, user.organizationId);
  }

  @Patch(':id')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'update', entityType: 'Shipment' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateShipmentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.update(id, dto, user.organizationId);
  }

  @Post(':id/dispatch')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'dispatch', entityType: 'Shipment' })
  dispatch(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.dispatch(id, user.organizationId);
  }

  /** TZ-SHIP-433 — отмена ошибочной отгрузки до dispatch (400 после списания). */
  @Post(':id/cancel-shipment')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'cancel_shipment', entityType: 'Shipment' })
  cancelShipment(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.cancelShipment(id, user.organizationId);
  }

  @Post(':id/add-doc')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'add_doc', entityType: 'Shipment' })
  addDoc(
    @Param('id') id: string,
    @Body() dto: AddDocDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.addDoc(id, dto, user.organizationId);
  }

  @Delete(':id')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'delete', entityType: 'Shipment' })
  remove(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.remove(id, user.organizationId);
  }
}
