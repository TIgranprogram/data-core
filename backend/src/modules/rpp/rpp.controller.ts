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
import { RppService } from './rpp.service';
import { CreateRppDto } from './dto/create-rpp.dto';
import { UpdateRppDto } from './dto/update-rpp.dto';
import { AuditAction } from '../../common/decorators/audit-action.decorator';

@Controller()
export class RppController {
  constructor(private readonly service: RppService) {}

  @Get('rpps/expiring')
  expiring(@Query('days') days?: string) {
    const n = days ? parseInt(days, 10) : 30;
    return this.service.findExpiring(Number.isFinite(n) ? n : 30);
  }

  @Post('rpps')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'create', entityType: 'Rpp' })
  create(@Body() dto: CreateRppDto) {
    return this.service.create(dto);
  }

  @Get('rpps')
  findAll() {
    return this.service.findAll();
  }

  @Get('rpps/:id')
  findOne(@Param('id') id: string) {
    return this.service.findById(id);
  }

  @Patch('rpps/:id')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'update', entityType: 'Rpp' })
  update(@Param('id') id: string, @Body() dto: UpdateRppDto) {
    return this.service.update(id, dto);
  }

  @Delete('rpps/:id')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'delete', entityType: 'Rpp' })
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
