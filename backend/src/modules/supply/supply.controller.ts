import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, type AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { SupplyReceiveDto, SupplyRequestDto } from './dto';
import { SupplyService } from './supply.service';

/** Заявки снабжения на общей коллекции CRM `supplyrequests`. Роли — как в CRM kppdf. */
@ApiTags('Снабжение')
@Controller('supply')
export class SupplyController {
  constructor(private readonly supply: SupplyService) {}

  @Get('requests')
  @Roles('admin', 'director', 'manager', 'user')
  list(@Query('search') search?: string, @Query('status') status?: string, @Query('page') page?: string, @Query('limit') limit?: string) {
    return this.supply.list({ search, status, page: Number(page) || 1, limit: Number(limit) || 1000 });
  }

  /** Подсказки для формы: поставщики, наши компании, категории. */
  @Get('lookups')
  @Roles('admin', 'director', 'manager', 'user')
  lookups() {
    return this.supply.lookups();
  }

  @Get('requests/:id')
  @Roles('admin', 'director', 'manager', 'user')
  get(@Param('id') id: string) {
    return this.supply.get(id);
  }

  @Post('requests')
  @Roles('admin', 'manager')
  create(@Body() dto: SupplyRequestDto, @CurrentUser() user?: AuthenticatedUser) {
    return this.supply.create(dto, user?.id);
  }

  @Patch('requests/:id')
  @Roles('admin', 'manager')
  update(@Param('id') id: string, @Body() dto: SupplyRequestDto) {
    return this.supply.update(id, dto);
  }

  /** Оприходовать на склад: приход + статус «Получено». */
  @Post('requests/:id/receive')
  @HttpCode(200)
  @Roles('admin', 'manager')
  receive(@Param('id') id: string, @Body() dto: SupplyReceiveDto, @CurrentUser() user?: AuthenticatedUser) {
    return this.supply.receive(id, dto, user?.id);
  }
}
