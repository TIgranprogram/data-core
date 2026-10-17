import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseInterceptors } from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { ReconciliationActService } from './reconciliation-act.service';
import { CreateReconciliationActDto } from './dto/create-reconciliation-act.dto';
import { UpdateReconciliationActDto } from './dto/update-reconciliation-act.dto';
import { SignActDto } from './dto/sign-act.dto';
import { AuditAction } from '../../common/decorators/audit-action.decorator';
import { RequireOrgScope } from '../../common/decorators/require-org-scope.decorator';
import { OrgScopeGuardInterceptor } from '../../common/interceptors/org-scope.interceptor';

@RequireOrgScope()
@UseInterceptors(OrgScopeGuardInterceptor)
@Controller('reconciliation-acts')
export class ReconciliationActController {
  constructor(private readonly service: ReconciliationActService) {}

  @Get()
  findAll(
    @Query('organizationId') organizationId?: string,
    @Query('periodStart') periodStart?: string,
    @Query('periodEnd') periodEnd?: string,
  ) {
    return this.service.findAll(
      organizationId,
      periodStart ? new Date(periodStart) : undefined,
      periodEnd ? new Date(periodEnd) : undefined,
    );
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findById(id);
  }

  @Post()
  @Roles('admin', 'manager')
  @AuditAction({ action: 'create', entityType: 'ReconciliationAct' })
  create(@Body() dto: CreateReconciliationActDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'update', entityType: 'ReconciliationAct' })
  update(@Param('id') id: string, @Body() dto: UpdateReconciliationActDto) {
    return this.service.update(id, dto);
  }

  @Post(':id/sign')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'sign', entityType: 'ReconciliationAct' })
  sign(@Param('id') id: string, @Body() dto: SignActDto) {
    return this.service.sign(id, dto);
  }

  @Delete(':id')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'delete', entityType: 'ReconciliationAct' })
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
