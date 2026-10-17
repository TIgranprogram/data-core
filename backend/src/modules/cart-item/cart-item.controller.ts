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
import { CartItemService } from './cart-item.service';
import { CreateCartItemDto } from './dto/create-cart-item.dto';
import { UpdateCartItemDto } from './dto/update-cart-item.dto';
import { AuditAction } from '../../common/decorators/audit-action.decorator';

@Controller('cart-items')
export class CartItemController {
  constructor(private readonly service: CartItemService) {}

  @Get()
  findAll(@Query('sessionId') sessionId?: string) {
    return this.service.findAll(sessionId);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findById(id);
  }

  @Post()
  @Roles('admin', 'manager')
  @AuditAction({ action: 'create', entityType: 'CartItem' })
  create(@Body() dto: CreateCartItemDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'update', entityType: 'CartItem' })
  update(@Param('id') id: string, @Body() dto: UpdateCartItemDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'delete', entityType: 'CartItem' })
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
