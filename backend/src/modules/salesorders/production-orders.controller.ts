import { Body, Controller, Get, HttpCode, Param, Post, Query, UseInterceptors } from '@nestjs/common';
import { ApiQuery, ApiTags } from '@nestjs/swagger';
import { AppSection } from '../../common/decorators/app-section.decorator';
import { CurrentUser, type AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { MoneyMaskInterceptor } from '../../common/interceptors/money-mask.interceptor';
import { openSectionsFor, sectionOpen } from '../../common/app-sections';
import { ProductionStageDto } from './dto';
import { ProductionOrdersService } from './production-orders.service';

/**
 * Заказы производства: договоры с одним «№ заказа» (productionNo) — один заказ; договор без № — отдельный.
 * `:key` — № заказа («21-26») или id договора без №.
 */
@ApiTags('Заказы производства')
@UseInterceptors(MoneyMaskInterceptor)
@AppSection('salesorders')
@Controller('production-orders')
export class ProductionOrdersController {
  constructor(private readonly svc: ProductionOrdersService) {}

  @Get()
  @Roles('admin', 'director', 'manager', 'user')
  @ApiQuery({ name: 'page', required: false }) @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'search', required: false, description: 'как у /salesorders; заказ находится, если подошёл любой его договор' })
  @ApiQuery({ name: 'sort', required: false, description: 'productionNo | deadline | customer | createdAt; «-» — по убыванию (умолч. -createdAt)' })
  @ApiQuery({ name: 'filter', required: false, description: 'active | done | all — по этапу заказа (самый отстающий договор)' })
  @ApiQuery({ name: 'stage', required: false }) @ApiQuery({ name: 'companyId', required: false }) @ApiQuery({ name: 'priority', required: false })
  @ApiQuery({ name: 'from', required: false }) @ApiQuery({ name: 'to', required: false })
  list(@Query() q: Record<string, string>) {
    return this.svc.list(q);
  }

  @Get(':key')
  @Roles('admin', 'director', 'manager', 'user')
  get(@Param('key') key: string, @CurrentUser() user?: AuthenticatedUser) {
    return this.svc.get(key, this.see(user));
  }

  /** Этап «ко всем договорам»: подтягивает отстающие до выбранного; ответ — карточка + `changed` (id изменённых договоров). */
  @Post(':key/stage')
  @HttpCode(200)
  @Roles('admin', 'manager')
  setStage(@Param('key') key: string, @Body() dto: ProductionStageDto, @CurrentUser() user?: AuthenticatedUser) {
    return this.svc.setStage(key, dto.stage, this.see(user));
  }

  private see(user?: AuthenticatedUser) {
    const open = openSectionsFor(user);
    return { requests: sectionOpen(open, 'requests'), stock: sectionOpen(open, 'stock') };
  }
}
