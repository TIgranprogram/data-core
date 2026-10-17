import {
  Body,
  Controller,
  Get,
  Param,
  Post,
} from '@nestjs/common';
import { AuditAction } from '../../common/interceptors/audit.interceptor';
import { Roles } from '../../common/decorators/roles.decorator';
import { BomService, CreateBomDto } from './bom.service';

@Controller('boms')
export class BomController {
  constructor(private readonly service: BomService) {}

  @Get('product/:productId')
  @Roles('admin', 'manager')
  listByProduct(@Param('productId') productId: string) {
    return this.service.findByProduct(productId);
  }

  @Get(':id')
  @Roles('admin', 'manager')
  findOne(@Param('id') id: string) {
    return this.service.findById(id);
  }

  @Get(':id/expanded')
  @Roles('admin', 'manager')
  getExpanded(@Param('id') id: string) {
    return this.service.getExpanded(id);
  }

  @Post()
  @Roles('admin', 'manager')
  @AuditAction({ action: 'create', entityType: 'Bom' })
  create(@Body() dto: CreateBomDto) {
    return this.service.create(dto);
  }

  @Post(':id/activate')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'activate', entityType: 'Bom' })
  activate(@Param('id') id: string) {
    return this.service.activate(id);
  }
}
