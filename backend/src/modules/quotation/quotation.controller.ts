import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseInterceptors,
} from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuthenticatedUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { QuotationService } from './quotation.service';
import { CreateQuotationDto } from './dto/create-quotation.dto';
import { UpdateQuotationDto } from './dto/update-quotation.dto';
import { AttachOrganizationsDto } from './dto/attach-organizations.dto';
import { AuditAction } from '../../common/decorators/audit-action.decorator';
import { RequireOrgScope } from '../../common/decorators/require-org-scope.decorator';
import { OrgScopeGuardInterceptor } from '../../common/interceptors/org-scope.interceptor';

@RequireOrgScope()
@UseInterceptors(OrgScopeGuardInterceptor)
@Controller('quotations')
export class QuotationController {
  constructor(private readonly service: QuotationService) {}

  @Get()
  findAll(
    @Query('counterpartyId') counterpartyId?: string,
    @Query('status') status?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.service.findAll(
      counterpartyId,
      status,
      from ? new Date(from) : undefined,
      to ? new Date(to) : undefined,
    );
  }

  @Get(':id/family')
  getFamily(@Param('id') id: string) {
    return this.service.getFamily(id);
  }

  @Post(':id/freeze')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'freeze', entityType: 'Quotation' })
  freeze(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.freeze(id, user.id);
  }

  @Get(':id/versions')
  listVersions(@Param('id') id: string) {
    return this.service.listVersions(id);
  }

  @Get(':id/versions/:version')
  getVersion(@Param('id') id: string, @Param('version') version: string) {
    const parsedVersion = Number(version);
    if (!Number.isInteger(parsedVersion) || parsedVersion < 1) {
      throw new BadRequestException('Version must be a positive integer');
    }
    return this.service.getVersion(id, parsedVersion);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findById(id);
  }

  @Post()
  @Roles('admin', 'manager')
  @AuditAction({ action: 'create', entityType: 'Quotation' })
  create(@Body() dto: CreateQuotationDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'update', entityType: 'Quotation' })
  update(@Param('id') id: string, @Body() dto: UpdateQuotationDto) {
    return this.service.update(id, dto);
  }

  @Post(':id/duplicate')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'duplicate', entityType: 'Quotation' })
  duplicate(@Param('id') id: string) {
    return this.service.duplicate(id);
  }

  @Post(':id/family/attach-organizations')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'family_attach', entityType: 'Quotation' })
  attachOrganizations(@Param('id') id: string, @Body() dto: AttachOrganizationsDto) {
    return this.service.attachOrganizations(id, dto);
  }

  @Post(':id/family/sync-from-master')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'family_sync', entityType: 'Quotation' })
  syncFromMaster(@Param('id') id: string) {
    return this.service.syncFromMaster(id);
  }

  @Post(':id/convert-to-contract')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'convert_to_contract', entityType: 'Quotation' })
  convertToContract(@Param('id') id: string, @Body() body: { title?: string }) {
    return this.service.convertToContract(id, body?.title);
  }

  @Post(':id/convert-to-order')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'convert_to_order', entityType: 'Quotation' })
  convertToOrder(
    @Param('id') id: string,
    @Body() body: { deliveryAddress?: string; managerId?: string },
  ) {
    return this.service.convertToOrder(id, body?.deliveryAddress, body?.managerId);
  }

  @Delete(':id')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'delete', entityType: 'Quotation' })
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
