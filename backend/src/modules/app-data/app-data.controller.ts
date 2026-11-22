import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBody, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { AppKeyRoute } from '../../common/decorators/app-key-route.decorator';
import { AuditAction } from '../../common/decorators/audit-action.decorator';
import { effectivePermissions } from '../../common/contracts/rbac-contract';
import { AppDataService } from './app-data.service';
import { AppDataRequestUser, AppScopeGuard, allowedApps } from './app-scope.guard';
import { FILTER_OPERATORS, MAX_BULK, MAX_LIMIT } from './app-data.validation';

interface AppDataRequest {
  user?: AppDataRequestUser;
}

/** Журнал аудита: app/collection — в details (entityId — только ObjectId документа). */
function auditDetails(data: unknown, params: Record<string, string>): Record<string, unknown> {
  const base = { app: params.app, collection: params.collection };
  const bulk = data as { items?: { id: string }[] } | undefined;
  if (bulk && Array.isArray(bulk.items)) {
    return { ...base, bulk: true, total: bulk.items.length, ids: bulk.items.map((d) => d.id) };
  }
  return { ...base, after: data };
}

const ENTITY = 'AppData';

@ApiTags('Данные приложений')
@Controller('apps')
@UseGuards(AppScopeGuard)
export class AppDataController {
  constructor(private readonly service: AppDataService) {}

  @Get()
  @AppKeyRoute()
  @Permissions('app-data:read')
  @ApiOperation({ summary: 'Приложения и их коллекции со счётчиками (count — живые, deleted — помеченные)' })
  listApps(@Req() req: AppDataRequest) {
    return this.service.listApps(allowedApps(req.user));
  }

  @Get(':app/:collection')
  @AppKeyRoute()
  @Permissions('app-data:read')
  @ApiOperation({ summary: 'Список документов { items, total, page, limit }' })
  @ApiQuery({ name: 'page', type: String, required: false, description: 'Номер страницы, с 1' })
  @ApiQuery({ name: 'limit', type: String, required: false, description: `Размер страницы, по умолчанию 50, максимум ${MAX_LIMIT}` })
  @ApiQuery({ name: 'sort', type: String, required: false, description: '`field` или `-field`, несколько через запятую' })
  @ApiQuery({
    name: 'filter',
    type: String,
    required: false,
    description: `JSON: {"field": value} или {"field": {"$op": value}}; операторы: ${FILTER_OPERATORS.join(' ')}`,
  })
  list(
    @Param('app') app: string,
    @Param('collection') collection: string,
    @Query('page') page?: unknown,
    @Query('limit') limit?: unknown,
    @Query('sort') sort?: unknown,
    @Query('filter') filter?: unknown,
  ) {
    return this.service.list(app, collection, { page, limit, sort, filter });
  }

  @Get(':app/:collection/:id')
  @AppKeyRoute()
  @Permissions('app-data:read')
  @ApiResponse({ status: 404, description: 'Нет документа (или он удалён)' })
  findOne(@Param('app') app: string, @Param('collection') collection: string, @Param('id') id: string) {
    return this.service.findOne(app, collection, id);
  }

  @Post(':app/:collection')
  @AppKeyRoute()
  @Permissions('app-data:write')
  @AuditAction({ action: 'create', entityType: ENTITY, details: auditDetails })
  @ApiOperation({ summary: `Создать документ (объект) или пачку (массив до ${MAX_BULK})` })
  @ApiBody({ schema: { oneOf: [{ type: 'object' }, { type: 'array', items: { type: 'object' } }] } })
  @ApiResponse({ status: 413, description: 'Документ больше 256 КБ' })
  create(
    @Param('app') app: string,
    @Param('collection') collection: string,
    @Body() body: unknown,
    @Req() req: AppDataRequest,
  ) {
    return this.service.create(app, collection, body, req.user?.id);
  }

  @Patch(':app/:collection/:id')
  @AppKeyRoute()
  @Permissions('app-data:write')
  @AuditAction({ action: 'update', entityType: ENTITY, idParam: 'id', details: auditDetails })
  @ApiOperation({ summary: 'Слияние верхнего уровня: переданные поля перезаписываются, остальные сохраняются' })
  @ApiBody({ schema: { type: 'object' } })
  patch(
    @Param('app') app: string,
    @Param('collection') collection: string,
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: AppDataRequest,
  ) {
    return this.service.patch(app, collection, id, body, req.user?.id);
  }

  @Put(':app/:collection/:id')
  @AppKeyRoute()
  @Permissions('app-data:write')
  @AuditAction({ action: 'replace', entityType: ENTITY, idParam: 'id', details: auditDetails })
  @ApiOperation({ summary: 'Полная замена документа (служебные поля сохраняет сервер)' })
  @ApiBody({ schema: { type: 'object' } })
  replace(
    @Param('app') app: string,
    @Param('collection') collection: string,
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: AppDataRequest,
  ) {
    return this.service.replace(app, collection, id, body, req.user?.id);
  }

  @Delete(':app/:collection/:id')
  @AppKeyRoute()
  @HttpCode(200)
  @Permissions('app-data:write')
  @AuditAction({ action: 'delete', entityType: ENTITY, idParam: 'id', details: auditDetails })
  @ApiOperation({ summary: 'Soft-delete (deletedAt); физическое удаление доступно отдельно' })
  @ApiQuery({ name: 'hard', type: String, required: false, description: 'true — удалить физически с правом app-data:admin. Ключ своего приложения допускает мягкое удаление' })
  remove(
    @Param('app') app: string,
    @Param('collection') collection: string,
    @Param('id') id: string,
    @Req() req: AppDataRequest,
    @Query('hard') hard?: unknown,
  ) {
    if (hard !== undefined && typeof hard !== 'string') {
      throw new BadRequestException('hard должен быть одним значением');
    }
    const isHard = hard === 'true' || hard === '1';
    if (isHard && req.user?.keyScope?.access === 'app') {
      throw new ForbiddenException('Ключ своего приложения разрешает только мягкое удаление');
    }
    if (isHard && !canHardDelete(req.user)) {
      throw new ForbiddenException('Физическое удаление требует права app-data:admin');
    }
    return this.service.remove(app, collection, id, isHard, req.user?.id);
  }
}

function canHardDelete(user: AppDataRequestUser | undefined): boolean {
  if (!user) return false;
  if (user.isOwner === true) return true;
  const effective = effectivePermissions(
    { permissions: user.permissions ?? [] },
    { name: user.role, permissions: user.rolePermissions ?? [] },
  );
  return effective.has('app-data:admin');
}
