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
import { OrderClosingService } from './order-closing.service';
import { CreateOrderClosingDto } from './dto/create-order-closing.dto';
import { AuditAction } from '../../common/decorators/audit-action.decorator';
import { RequireOrgScope } from '../../common/decorators/require-org-scope.decorator';
import { OrgScopeGuardInterceptor } from '../../common/interceptors/org-scope.interceptor';

@RequireOrgScope()
@UseInterceptors(OrgScopeGuardInterceptor)
@Controller()
export class OrderClosingController {
  constructor(private readonly service: OrderClosingService) {}

  @Post('production-orders/:productionOrderId/closing')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'create', entityType: 'OrderClosing' })
  createForOrder(
    @Param('productionOrderId') productionOrderId: string,
    @Body() dto: CreateOrderClosingDto,
  ) {
    return this.service.create({ ...dto, productionOrderId });
  }

  @Get('production-orders/:productionOrderId/closing')
  findForOrder(@Param('productionOrderId') productionOrderId: string) {
    return this.service.findAll(productionOrderId);
  }

  @Get('order-closings')
  findAll(@Query('productionOrderId') productionOrderId?: string) {
    return this.service.findAll(productionOrderId);
  }

  @Get('order-closings/:id')
  findOne(@Param('id') id: string) {
    return this.service.findById(id);
  }

  @Delete('order-closings/:id')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'delete', entityType: 'OrderClosing' })
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
