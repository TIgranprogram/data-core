import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { CostCalculationService } from './cost-calculation.service';
import { CreateCostCalculationDto } from './dto/create-cost-calculation.dto';
import { UpdateCostCalculationDto } from './dto/update-cost-calculation.dto';
import { AuditAction } from '../../common/decorators/audit-action.decorator';

@Controller()
export class CostCalculationController {
  constructor(private readonly service: CostCalculationService) {}

  @Post('products/:productId/cost-calculations')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'create', entityType: 'CostCalculation' })
  createForProduct(
    @Param('productId') productId: string,
    @Body() dto: CreateCostCalculationDto,
  ) {
    return this.service.create({ ...dto, productId });
  }

  @Get('products/:productId/cost-calculations')
  findForProduct(
    @Param('productId') productId: string,
    @Query('isActive') isActive?: string,
  ) {
    const active =
      isActive === undefined ? undefined : isActive === 'true' || isActive === '1';
    return this.service.findAll(productId, active);
  }

  @Get('cost-calculations')
  findAll(@Query('isActive') isActive?: string) {
    const active =
      isActive === undefined ? undefined : isActive === 'true' || isActive === '1';
    return this.service.findAll(undefined, active);
  }

  @Get('cost-calculations/:id')
  findOne(@Param('id') id: string) {
    return this.service.findById(id);
  }

  @Post('cost-calculations/:id/activate')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'activate', entityType: 'CostCalculation' })
  activate(@Param('id') id: string) {
    return this.service.activate(id);
  }

  @Patch('cost-calculations/:id')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'update', entityType: 'CostCalculation' })
  update(@Param('id') id: string, @Body() dto: UpdateCostCalculationDto) {
    return this.service.update(id, dto);
  }

  @Delete('cost-calculations/:id')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'delete', entityType: 'CostCalculation' })
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
