import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import { AuditAction } from '../../../common/interceptors/audit.interceptor';
import { Roles } from '../../../common/decorators/roles.decorator';
import { OrganizationContactService } from './organization-contact.service';

interface AddContactDto {
  personId: string;
  isPrimary?: boolean;
  role?: string;
}

@Controller('organizations/:orgId/contacts')
export class OrganizationContactController {
  constructor(private readonly service: OrganizationContactService) {}

  @Get()
  @Roles('admin', 'director', 'manager')
  list(@Param('orgId') orgId: string) {
    return this.service.list(orgId);
  }

  @Post()
  @Roles('admin', 'manager')
  @AuditAction({ action: 'add-contact', entityType: 'Organization' })
  add(@Param('orgId') orgId: string, @Body() dto: AddContactDto) {
    return this.service.add(orgId, dto.personId, { isPrimary: dto.isPrimary, role: dto.role });
  }

  @Delete(':personId')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'remove-contact', entityType: 'Organization' })
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('orgId') orgId: string, @Param('personId') personId: string) {
    return this.service.remove(orgId, personId);
  }
}
