import {
  Body,
  Controller,
  Get,
  Param,
  Post,
} from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { CartSessionService } from './cart-session.service';
import { CreateCartSessionDto } from './dto/create-cart-session.dto';
import { AuditAction } from '../../common/decorators/audit-action.decorator';
import { IsObjectId as IsObjectIdCustom } from '../../common/decorators/is-object-id.decorator';
import { IsNotEmpty } from 'class-validator';

class CheckoutDto {
  @IsNotEmpty() @IsObjectIdCustom()
  organizationId!: string;

  @IsNotEmpty() @IsObjectIdCustom()
  counterpartyId!: string;
}

@Controller('cart-sessions')
export class CartSessionController {
  constructor(private readonly service: CartSessionService) {}

  @Post()
  @Roles('admin', 'manager')
  create(@Body() dto: CreateCartSessionDto) {
    return this.service.create(dto);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findById(id);
  }

  @Get(':id/items')
  findItems(@Param('id') id: string) {
    return this.service.findItems(id);
  }

  @Post(':sessionId/checkout')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'checkout', entityType: 'CartSession' })
  checkout(@Param('sessionId') sessionId: string, @Body() dto: CheckoutDto) {
    return this.service.checkout(sessionId, dto.organizationId, dto.counterpartyId);
  }
}
