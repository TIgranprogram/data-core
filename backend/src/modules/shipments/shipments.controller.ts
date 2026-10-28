import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Res, StreamableFile } from '@nestjs/common';
import { ApiQuery, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { AppSection } from '../../common/decorators/app-section.decorator';
import { AuditAction } from '../../common/decorators/audit-action.decorator';
import { CurrentUser, type AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CreateShipmentDto, UpdateShipmentDto } from './dto';
import { ShipmentsService } from './shipments.service';

/**
 * Отгрузки заказов. Смотреть — все роли; отгружать, править, отменять — admin и manager.
 * Каждая запись журнала привязана к заказу (entityType Shipment, details.after.orderId) — история заказа читает её оттуда.
 */
@ApiTags('Отгрузки')
@AppSection('salesorders')
@Controller()
export class ShipmentsController {
  constructor(private readonly shipments: ShipmentsService) {}

  /** { items, total, remaining:[{incomeId, qty, shipped, left}], stage, legacyShipped }. */
  @Get('salesorders/:id/shipments')
  @Roles('admin', 'director', 'manager', 'user')
  @ApiQuery({ name: 'deleted', required: false, description: '1 — отменённые (для восстановления)' })
  list(@Param('id') id: string, @Query('deleted') deleted?: string) {
    return this.shipments.list(id, deleted === '1');
  }

  @Post('salesorders/:id/shipments')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'shipment.created', entityType: 'Shipment' })
  create(@Param('id') id: string, @Body() dto: CreateShipmentDto, @CurrentUser() user: AuthenticatedUser) {
    return this.shipments.create(id, dto, user);
  }

  @Patch('shipments/:id')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'shipment.updated', entityType: 'Shipment', idParam: 'id' })
  update(@Param('id') id: string, @Body() dto: UpdateShipmentDto) {
    return this.shipments.update(id, dto);
  }

  /** Отмена отгрузки: в корзину, остаток возвращается, этап заказа пересчитывается. */
  @Delete('shipments/:id')
  @HttpCode(200)
  @Roles('admin', 'manager')
  @AuditAction({ action: 'shipment.deleted', entityType: 'Shipment', idParam: 'id' })
  remove(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.shipments.remove(id, user);
  }

  @Post('shipments/:id/restore')
  @HttpCode(200)
  @Roles('admin', 'manager')
  @AuditAction({ action: 'shipment.restored', entityType: 'Shipment', idParam: 'id' })
  restore(@Param('id') id: string) {
    return this.shipments.restore(id);
  }

  /** Печатная форма: PDF А4, чёрно-белый. */
  @Get('shipments/:id/pdf')
  @Roles('admin', 'director', 'manager', 'user')
  async pdf(@Param('id') id: string, @Res({ passthrough: true }) res: Response) {
    const r = await this.shipments.pdf(id);
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="shipment.pdf"; filename*=UTF-8''${encodeURIComponent(r.filename)}` });
    return new StreamableFile(r.buf);
  }
}
