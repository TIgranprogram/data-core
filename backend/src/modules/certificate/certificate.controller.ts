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
import { CertificateService } from './certificate.service';
import { CreateCertificateDto } from './dto/create-certificate.dto';
import { UpdateCertificateDto } from './dto/update-certificate.dto';
import { AuditAction } from '../../common/decorators/audit-action.decorator';

@Controller('certificates')
export class CertificateController {
  constructor(private readonly service: CertificateService) {}

  @Get()
  findAll(@Query('productId') productId?: string) {
    return this.service.findAll(productId);
  }

  @Get('expiring')
  findExpiring(@Query('days') days?: string) {
    const n = days ? parseInt(days, 10) : 30;
    return this.service.findExpiring(Number.isFinite(n) ? n : 30);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findById(id);
  }

  @Post()
  @Roles('admin', 'manager')
  @AuditAction({ action: 'create', entityType: 'Certificate' })
  create(@Body() dto: CreateCertificateDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'update', entityType: 'Certificate' })
  update(@Param('id') id: string, @Body() dto: UpdateCertificateDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'delete', entityType: 'Certificate' })
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
