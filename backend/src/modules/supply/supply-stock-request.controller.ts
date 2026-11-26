import { Body, Controller, Get, Ip, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AppSection } from '../../common/decorators/app-section.decorator';
import { CurrentUser, type AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { StockScoped } from '../../common/decorators/stock-scoped.decorator';
import { OwnerIdempotency } from '../../common/idempotency/owner-idempotency.decorator';
import type { StockScope } from '../../common/stock-scope';
import { StockItemReservationsDto } from '../stock';
import { SupplyStockRequestDto, SupplyStockRequestQueryDto } from './supply-stock-request.dto';
import { SupplyService } from './supply.service';

@ApiTags('Склад')
@AppSection('stock')
@Controller('stock/items')
export class SupplyStockRequestController {
  constructor(private readonly supply: SupplyService) {}

  @Get(':id/requests')
  @Roles('admin', 'director', 'manager', 'user')
  list(@Param('id') id: string, @Query() query: StockItemReservationsDto, @StockScoped() scope: StockScope | null) {
    return this.supply.listStockRequests(id, query, scope);
  }

  @Post(':id/request')
  @Roles('admin', 'manager')
  @OwnerIdempotency()
  create(@Param('id') id: string, @Body() dto: SupplyStockRequestDto,
    @Query() _query: SupplyStockRequestQueryDto, @StockScoped() scope: StockScope | null,
    @Ip() ipAddress: string, @CurrentUser() user?: AuthenticatedUser) {
    return this.supply.createStockRequest(id, dto, user?.id, scope, { userName: user?.username, ipAddress });
  }
}
