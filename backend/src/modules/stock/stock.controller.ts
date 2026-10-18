import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, type AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { StockItemDto, StockMoveDto, StockPhotoDto } from './dto';
import { StockService } from './stock.service';

/**
 * Склад на общих коллекциях CRM (materials + storageitems + stockmovements + reservations).
 * Роли — как в CRM kppdf: читать могут все, менять — admin и manager.
 */
@ApiTags('Склад')
@Controller('stock')
export class StockController {
  constructor(private readonly stock: StockService) {}

  @Get('warehouses')
  @Roles('admin', 'director', 'manager', 'user')
  warehouses() {
    return this.stock.listWarehouses();
  }

  /** Позиции склада по умолчанию: материал + остаток / бронь / свободно. */
  @Get('items')
  @Roles('admin', 'director', 'manager', 'user')
  list(@Query('search') search?: string, @Query('categoryId') categoryId?: string, @Query('page') page?: string, @Query('limit') limit?: string) {
    return this.stock.listItems({ search, categoryId, page: Number(page) || 1, limit: Number(limit) || 1000 });
  }

  @Get('items/:id')
  @Roles('admin', 'director', 'manager', 'user')
  get(@Param('id') id: string) {
    return this.stock.getItem(id);
  }

  @Get('items/:id/history')
  @Roles('admin', 'director', 'manager', 'user')
  history(@Param('id') id: string) {
    return this.stock.history(id);
  }

  /** Новая позиция (материал + строка остатка). Такое же наименование — вернётся существующая. */
  @Post('items')
  @Roles('admin', 'manager')
  create(@Body() dto: StockItemDto) {
    return this.stock.createItem(dto);
  }

  @Patch('items/:id')
  @Roles('admin', 'manager')
  update(@Param('id') id: string, @Body() dto: StockItemDto) {
    return this.stock.updateItem(id, dto);
  }

  @Post('items/:id/photos')
  @Roles('admin', 'manager')
  photo(@Param('id') id: string, @Body() dto: StockPhotoDto) {
    return this.stock.addPhoto(id, dto.photoId);
  }

  /** Приход / списание / корректировка / бронь / снятие брони. */
  @Post('items/:id/move')
  @Roles('admin', 'manager')
  move(@Param('id') id: string, @Body() dto: StockMoveDto, @CurrentUser() user?: AuthenticatedUser) {
    return this.stock.move(id, dto, user?.id);
  }
}
