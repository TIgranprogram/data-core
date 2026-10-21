import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { AuditAction } from '../../common/interceptors/audit.interceptor';
import { Roles } from '../../common/decorators/roles.decorator';
import { CreateSiteDto, EnsureDefaultSiteDto, UpdateSiteDto } from './dto/create-site.dto';
import { SiteService } from './site.service';

@Controller('sites')
export class SiteController {
  constructor(private readonly service: SiteService) {}

  @Get()
  @Roles('admin', 'director', 'manager', 'user')
  list(@Query('counterpartyId') counterpartyId?: string) {
    if (!counterpartyId) return [];
    return this.service.findByCounterparty(counterpartyId);
  }

  @Post('ensure-default')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'create', entityType: 'Site' })
  ensureDefault(@Body() dto: EnsureDefaultSiteDto) {
    return this.service.ensureDefaultForCounterparty(dto.counterpartyId);
  }

  @Get(':id')
  @Roles('admin', 'director', 'manager', 'user')
  findOne(@Param('id') id: string) {
    return this.service.findById(id);
  }

  @Post()
  @Roles('admin', 'manager')
  @AuditAction({ action: 'create', entityType: 'Site' })
  create(@Body() dto: CreateSiteDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'update', entityType: 'Site', idParam: 'id' })
  update(@Param('id') id: string, @Body() dto: UpdateSiteDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'delete', entityType: 'Site', idParam: 'id' })
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
