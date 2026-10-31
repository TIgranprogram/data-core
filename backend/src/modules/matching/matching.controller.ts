import { Body, Controller, Get, HttpCode, Post, Query, UseInterceptors } from '@nestjs/common';
import { ApiQuery, ApiTags } from '@nestjs/swagger';
import { AppSection } from '../../common/decorators/app-section.decorator';
import { CurrentUser, type AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { MoneyMaskInterceptor } from '../../common/interceptors/money-mask.interceptor';
import { BulkMatchDto, ConfirmMatchDto, NoneMatchDto } from './dto';
import { MatchingService } from './matching.service';

/** Сопоставление позиций договора с изделиями (КМ2–КМ3). Смотреть — все, менять — admin и manager. */
@ApiTags('Сопоставление позиций')
@UseInterceptors(MoneyMaskInterceptor)
@AppSection('salesorders')
@Controller('matching')
export class MatchingController {
  constructor(private readonly svc: MatchingService) {}

  @Get('suggest')
  @Roles('admin', 'director', 'manager', 'user')
  @ApiQuery({ name: 'orderId', required: true, description: 'id договора' })
  suggest(@Query('orderId') orderId: string) {
    return this.svc.suggest(orderId);
  }

  @Get('unmatched/count')
  @AppSection('salesorders', 'design')
  @Roles('admin', 'director', 'manager', 'user')
  unmatchedCount() {
    return this.svc.unmatchedCount();
  }

  @Get('unmatched')
  @AppSection('salesorders', 'design')
  @Roles('admin', 'director', 'manager', 'user')
  @ApiQuery({ name: 'inProduction', required: false, description: '1 — только в производстве, 0 — только без производственного №' })
  @ApiQuery({ name: 'productionNo', required: false, description: '№ заказа; «-» — заказы без №' })
  @ApiQuery({ name: 'orderNo', required: false, description: '№ договора' })
  @ApiQuery({ name: 'stage', required: false, description: 'этап договора: new | production | ready | partly | shipped | closed | cancelled' })
  unmatched(@Query('page') page?: string, @Query('limit') limit?: string, @Query('q') q?: string, @Query('orderId') orderId?: string, @Query('inProduction') inProduction?: string, @Query('productionNo') productionNo?: string, @Query('orderNo') orderNo?: string, @Query('stage') stage?: string) {
    return this.svc.unmatched({ page: Number(page), limit: Number(limit), q, orderId, inProduction, productionNo, orderNo, stage });
  }

  @Post('confirm')
  @HttpCode(200)
  @Roles('admin', 'manager')
  confirm(@Body() dto: ConfirmMatchDto, @CurrentUser() user?: AuthenticatedUser) {
    return this.svc.confirm(dto.lineId, dto.productId, user?.id);
  }

  @Post('none')
  @HttpCode(200)
  @Roles('admin', 'manager')
  none(@Body() dto: NoneMatchDto, @CurrentUser() user?: AuthenticatedUser) {
    return this.svc.none(dto.lineId, user?.id);
  }

  @Post('bulk')
  @HttpCode(200)
  @Roles('admin', 'manager')
  bulk(@Body() dto: BulkMatchDto, @CurrentUser() user?: AuthenticatedUser) {
    return this.svc.bulk(dto.items.map((i) => ({ lineId: i.lineId, productId: i.productId ?? null })), user?.id);
  }
}
