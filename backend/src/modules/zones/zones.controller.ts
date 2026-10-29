import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AuditAction } from '../../common/decorators/audit-action.decorator';
import { CurrentUser, type AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CreateZoneDto, PersonUserDto, PersonZonesDto, UpdateZoneDto } from './dto/zones.dto';
import { ZonesService } from './zones.service';

/** Зоны ответственности и экран «Сотрудники». Смотреть зоны — все роли (названия для фильтров), править и вести сотрудников — admin. */
@ApiTags('Зоны')
@Controller()
export class ZonesController {
  constructor(private readonly zones: ZonesService) {}

  @Get('zones')
  @Roles('admin', 'director', 'manager', 'user', 'accountant')
  listZones() { return this.zones.listZones(); }

  @Post('zones')
  @Roles('admin', 'director')
  @AuditAction({ action: 'zone.created', entityType: 'Zone' })
  createZone(@Body() dto: CreateZoneDto) { return this.zones.createZone(dto); }

  @Patch('zones/:id')
  @Roles('admin', 'director')
  @AuditAction({ action: 'zone.updated', entityType: 'Zone', idParam: 'id' })
  updateZone(@Param('id') id: string, @Body() dto: UpdateZoneDto) { return this.zones.updateZone(id, dto); }

  @Delete('zones/:id')
  @Roles('admin', 'director')
  @AuditAction({ action: 'zone.deleted', entityType: 'Zone', idParam: 'id' })
  removeZone(@Param('id') id: string) { return this.zones.removeZone(id); }

  @Get('staff')
  @Roles('admin', 'director', 'manager', 'user', 'accountant')
  staff(@Query() q: { zone?: string }, @CurrentUser() user: AuthenticatedUser) { return this.zones.staff(q, user); }

  /** Входы для выбора в карточке (до `:id`). */
  @Get('staff/logins')
  @Roles('admin', 'director')
  logins() { return this.zones.loginOptions(); }

  /** Создать сотрудника из входа без сотрудника (СВ-2). */
  @Post('staff/from-login')
  @Roles('admin', 'director')
  @AuditAction({ action: 'person.created.fromLogin', entityType: 'Person' })
  fromLogin(@Body() dto: PersonUserDto) {
    if (!dto.userId) throw new BadRequestException('Выберите вход');
    return this.zones.createFromLogin(dto.userId);
  }

  @Get('staff/:id')
  @Roles('admin', 'director')
  person(@Param('id') id: string) { return this.zones.person(id); }

  @Put('staff/:id/zones')
  @Roles('admin', 'director')
  @AuditAction({ action: 'person.zones.updated', entityType: 'Person', idParam: 'id' })
  setZones(@Param('id') id: string, @Body() dto: PersonZonesDto, @CurrentUser() user: AuthenticatedUser) {
    return this.zones.setZones(id, dto.zoneCodes, user.id, dto.note);
  }

  @Put('staff/:id/login')
  @Roles('admin', 'director')
  @AuditAction({ action: 'person.login.updated', entityType: 'Person', idParam: 'id' })
  linkLogin(@Param('id') id: string, @Body() dto: PersonUserDto) { return this.zones.linkUser(id, dto.userId); }

  /** История передач объекта: заявка, заказ, задача. */
  @Get('handoffs/:entity/:id')
  @Roles('admin', 'director', 'manager', 'user', 'accountant')
  handoffs(@Param('entity') entity: string, @Param('id') id: string) { return this.zones.handoffHistory(entity, id); }
}
