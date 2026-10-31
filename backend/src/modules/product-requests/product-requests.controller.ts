import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiQuery, ApiTags } from '@nestjs/swagger';
import { AppSection } from '../../common/decorators/app-section.decorator';
import { AuditAction } from '../../common/decorators/audit-action.decorator';
import { CurrentUser, type AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CreateProductRequestDto, RejectProductRequestDto } from './dto';
import { ProductRequestsService } from './product-requests.service';

/**
 * Заявки на создание нового изделия (ORDER-LINES). Смотреть — роли с разделом «Заказы» или «Проектирование»;
 * создавать — admin и manager; подтверждать и отклонять как дубль — раздел «Проектирование». Цен в ответах нет.
 */
@ApiTags('Заявки на новое изделие')
@AppSection('salesorders', 'design')
@Controller('product-requests')
export class ProductRequestsController {
  constructor(private readonly svc: ProductRequestsService) {}

  @Get('count')
  @Roles('admin', 'director', 'manager', 'user')
  count() { return this.svc.count(); }

  @Get()
  @Roles('admin', 'director', 'manager', 'user')
  @ApiQuery({ name: 'status', required: false, description: 'open (умолч.) | confirmed | rejected | all' })
  @ApiQuery({ name: 'search', required: false, description: 'по названию' })
  list(@Query() q: Record<string, string>) { return this.svc.list(q); }

  @Get(':id')
  @Roles('admin', 'director', 'manager', 'user')
  get(@Param('id') id: string) { return this.svc.get(id); }

  @Post()
  @Roles('admin', 'manager')
  @AuditAction({ action: 'productrequest.created', entityType: 'ProductRequest' })
  create(@Body() dto: CreateProductRequestDto, @CurrentUser() user?: AuthenticatedUser) { return this.svc.create(dto, user?.id); }

  @Post(':id/confirm')
  @HttpCode(200)
  @AppSection('design')
  @Roles('admin', 'manager', 'user')
  @AuditAction({ action: 'productrequest.confirmed', entityType: 'ProductRequest', idParam: 'id' })
  // тело — поля изделия как в POST /showcase (sku, type, group, passportCategory, certification…); название, описание, фото и цена по умолчанию — из заявки
  confirm(@Param('id') id: string, @Body() body: Record<string, unknown>, @CurrentUser() user?: AuthenticatedUser) { return this.svc.confirm(id, body ?? {}, user?.id); }

  @Post(':id/reject')
  @HttpCode(200)
  @AppSection('design')
  @Roles('admin', 'manager', 'user')
  @AuditAction({ action: 'productrequest.rejected', entityType: 'ProductRequest', idParam: 'id' })
  reject(@Param('id') id: string, @Body() dto: RejectProductRequestDto, @CurrentUser() user?: AuthenticatedUser) { return this.svc.reject(id, dto.productId, user?.id); }
}
