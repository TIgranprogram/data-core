import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AuditAction } from '../../common/decorators/audit-action.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CreateStockZoneDto, UpdateStockZoneDto } from './dto/stock-zone.dto';
import { StockZonesService } from './stock-zones.service';

/** Справочник «Склады» (какие позиции видит кладовщик). Правит admin; доступные пользователю — `GET /api/stock/zones`. */
@ApiTags('Склады (зоны доступа)')
@Controller('stockzones')
export class StockZonesController {
  constructor(private readonly zones: StockZonesService) {}

  @Get()
  @Roles('admin')
  list() { return this.zones.list(); }

  @Get(':id')
  @Roles('admin')
  get(@Param('id') id: string) { return this.zones.get(id); }

  @Post()
  @Roles('admin')
  @AuditAction({ action: 'stockzone.created', entityType: 'StockZone' })
  create(@Body() dto: CreateStockZoneDto) { return this.zones.create(dto); }

  @Patch(':id')
  @Roles('admin')
  @AuditAction({ action: 'stockzone.updated', entityType: 'StockZone', idParam: 'id' })
  update(@Param('id') id: string, @Body() dto: UpdateStockZoneDto) { return this.zones.update(id, dto); }

  @Delete(':id')
  @HttpCode(200)
  @Roles('admin')
  @AuditAction({ action: 'stockzone.deleted', entityType: 'StockZone', idParam: 'id' })
  remove(@Param('id') id: string) { return this.zones.remove(id); }
}
