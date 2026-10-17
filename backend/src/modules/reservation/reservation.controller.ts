import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UseInterceptors,
} from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { ReservationService } from './reservation.service';
import { CreateReservationDto } from './dto/create-reservation.dto';
import { AuditAction } from '../../common/decorators/audit-action.decorator';
import { RequireOrgScope } from '../../common/decorators/require-org-scope.decorator';
import { OrgScopeGuardInterceptor } from '../../common/interceptors/org-scope.interceptor';

@RequireOrgScope()
@UseInterceptors(OrgScopeGuardInterceptor)
@Controller('reservations')
export class ReservationController {
  constructor(private readonly service: ReservationService) {}

  @Get()
  findAll(@Query('orderId') orderId?: string) {
    return this.service.findAll(orderId);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findById(id);
  }

  @Post()
  @Roles('admin', 'manager')
  @AuditAction({ action: 'create', entityType: 'Reservation' })
  create(@Body() dto: CreateReservationDto) {
    return this.service.create(dto);
  }

  @Post(':id/release')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'release', entityType: 'Reservation' })
  release(@Param('id') id: string) {
    return this.service.release(id);
  }

  @Post(':id/fulfill')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'fulfill', entityType: 'Reservation' })
  fulfill(@Param('id') id: string) {
    return this.service.fulfill(id);
  }

  @Delete(':id')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'delete', entityType: 'Reservation' })
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
