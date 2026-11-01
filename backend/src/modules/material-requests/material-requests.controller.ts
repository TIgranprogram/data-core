import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiQuery, ApiTags } from '@nestjs/swagger';
import { AppSection } from '../../common/decorators/app-section.decorator';
import { AuditAction } from '../../common/decorators/audit-action.decorator';
import { CurrentUser, type AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { StockScoped } from '../../common/decorators/stock-scoped.decorator';
import type { StockScope } from '../../common/stock-scope';
import { CloseMaterialRequestDto, CreateMaterialRequestDto } from './dto';
import { MaterialRequestsService } from './material-requests.service';

/**
 * Заявки на новую позицию склада. Подать — роли с разделом «Склад» / «Склад (телефон)» (admin, manager, user);
 * смотреть и закрывать — с правом записи склада (admin, manager). Видны заявки своих складов.
 */
@ApiTags('Заявки на новую позицию склада')
@AppSection('stock')
@Controller('material-requests')
export class MaterialRequestsController {
  constructor(private readonly svc: MaterialRequestsService) {}

  @Post()
  @Roles('admin', 'manager', 'user')
  @AuditAction({ action: 'materialrequest.created', entityType: 'MaterialRequest' })
  create(@Body() dto: CreateMaterialRequestDto, @StockScoped() scope: StockScope | null, @CurrentUser() user?: AuthenticatedUser) { return this.svc.create(dto, scope, user); }

  @Get('count')
  @Roles('admin', 'manager')
  count(@StockScoped() scope: StockScope | null) { return this.svc.count(scope); }

  @Get()
  @Roles('admin', 'manager')
  @ApiQuery({ name: 'status', required: false, description: 'open (умолч.) | done | rejected | all' })
  list(@Query('status') status: string | undefined, @StockScoped() scope: StockScope | null) { return this.svc.list(scope, status); }

  @Post(':id/close')
  @HttpCode(200)
  @Roles('admin', 'manager')
  @AuditAction({ action: 'materialrequest.closed', entityType: 'MaterialRequest', idParam: 'id' })
  close(@Param('id') id: string, @Body() dto: CloseMaterialRequestDto, @StockScoped() scope: StockScope | null, @CurrentUser() user?: AuthenticatedUser) { return this.svc.close(id, dto, scope, user?.id); }
}
