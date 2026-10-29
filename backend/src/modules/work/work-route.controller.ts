import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AppSection } from '../../common/decorators/app-section.decorator';
import { AuditAction } from '../../common/decorators/audit-action.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RouteDto } from './dto/work.dto';
import { WorkRouteService } from './work-route.service';

/** «Как делается»: маршрут изделия — виды работ по порядку (`products.workTypes[]`). Править — admin и manager. */
@ApiTags('В работе')
@AppSection('work', 'products')
@Controller('work-routes')
export class WorkRouteController {
  constructor(private readonly routes: WorkRouteService) {}

  /** Маршрут, части состава для выбора и (если маршрута нет) подсказка из модулей изделия. */
  @Get(':productId')
  @Roles('admin', 'director', 'manager', 'user')
  get(@Param('productId') productId: string) {
    return this.routes.get(productId);
  }

  /** Записать маршрут целиком; порядок элементов = порядок работ; пустой — убрать. */
  @Put(':productId')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'workroute.updated', entityType: 'Product', idParam: 'productId' })
  set(@Param('productId') productId: string, @Body() dto: RouteDto) {
    return this.routes.set(productId, dto);
  }
}
