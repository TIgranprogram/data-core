import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiQuery, ApiTags } from '@nestjs/swagger';
import { AppSection } from '../../common/decorators/app-section.decorator';
import { AuditAction } from '../../common/decorators/audit-action.decorator';
import { CurrentUser, type AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CreateSupplierContractDto, PatchSupplierContractDto } from './dto-contract';
import { SupplierContractService } from './supplier-contract.service';

/** Договоры поставщиков. Читают роли снабжения/склада; создают и правят admin/manager; удаляют admin/manager. */
@ApiTags('Снабжение')
@AppSection('requests')
@Controller('supply/contracts')
export class SupplierContractController {
  constructor(private readonly contracts: SupplierContractService) {}

  @Get()
  @Roles('admin', 'director', 'manager', 'user')
  @ApiQuery({ name: 'supplierId', required: false }) @ApiQuery({ name: 'status', required: false, description: 'active | closed' })
  @ApiQuery({ name: 'q', required: false, description: '№, предмет или поставщик' }) @ApiQuery({ name: 'page', required: false }) @ApiQuery({ name: 'limit', required: false })
  list(@Query() q: Record<string, string>) {
    return this.contracts.list(q);
  }

  @Get(':id')
  @Roles('admin', 'director', 'manager', 'user')
  get(@Param('id') id: string) {
    return this.contracts.get(id);
  }

  @Post()
  @Roles('admin', 'manager')
  @AuditAction({ action: 'supply.contract.created', entityType: 'SupplierContract' })
  create(@Body() dto: CreateSupplierContractDto, @CurrentUser() user?: AuthenticatedUser) {
    return this.contracts.create(dto, user?.id);
  }

  @Patch(':id')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'supply.contract.updated', entityType: 'SupplierContract', idParam: 'id' })
  update(@Param('id') id: string, @Body() dto: PatchSupplierContractDto) {
    return this.contracts.update(id, dto);
  }

  @Delete(':id')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'supply.contract.deleted', entityType: 'SupplierContract', idParam: 'id' })
  remove(@Param('id') id: string) {
    return this.contracts.remove(id);
  }
}
