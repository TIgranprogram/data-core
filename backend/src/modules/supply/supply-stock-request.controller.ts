import { Body, Controller, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AppSection } from '../../common/decorators/app-section.decorator';
import { AuditAction } from '../../common/decorators/audit-action.decorator';
import { CurrentUser, type AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { StockScoped } from '../../common/decorators/stock-scoped.decorator';
import type { StockScope } from '../../common/stock-scope';
import { SupplyStockRequestDto, SupplyStockRequestQueryDto } from './supply-stock-request.dto';
import { SupplyService } from './supply.service';

@ApiTags('Склад')
@AppSection('stock')
@Controller('stock/items')
export class SupplyStockRequestController {
  constructor(private readonly supply: SupplyService) {}

  @Post(':id/request')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'supply.request.created', entityType: 'SupplyRequest' })
  create(@Param('id') id: string, @Body() dto: SupplyStockRequestDto,
    @Query() _query: SupplyStockRequestQueryDto, @StockScoped() scope: StockScope | null,
    @CurrentUser() user?: AuthenticatedUser) {
    return this.supply.createStockRequest(id, dto, user?.id, scope);
  }
}
