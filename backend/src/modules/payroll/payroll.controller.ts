import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiQuery, ApiTags } from '@nestjs/swagger';
import { AppSection } from '../../common/decorators/app-section.decorator';
import { AuditAction } from '../../common/decorators/audit-action.decorator';
import { CurrentUser, type AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { PayoutDto, PersonCompanyDto, TimesheetDto } from './dto';
import { PayrollService } from './payroll.service';

/** ФОТ: только денежные роли (admin, accountant; director и admin наследуют — roles-hierarchy). */
@ApiTags('ФОТ')
@AppSection('payroll')
@Controller('payroll')
export class PayrollController {
  constructor(private readonly payroll: PayrollService) {}

  @Get('summary')
  @Roles('admin', 'accountant')
  @ApiQuery({ name: 'month', required: false, description: 'ГГГГ-ММ (умолч. текущий)' })
  summary(@Query('month') month?: string) {
    return this.payroll.summary(month);
  }

  @Put('timesheet')
  @Roles('admin', 'accountant')
  @AuditAction({ action: 'payroll.timesheet.saved', entityType: 'PayrollTimesheet' })
  saveTimesheet(@Body() dto: TimesheetDto) {
    return this.payroll.saveTimesheet(dto);
  }

  @Get('payments')
  @Roles('admin', 'accountant')
  @ApiQuery({ name: 'month', required: false }) @ApiQuery({ name: 'personId', required: false })
  payments(@Query('month') month?: string, @Query('personId') personId?: string) {
    return this.payroll.payments(month, personId);
  }

  @Post('payments')
  @HttpCode(200)
  @Roles('admin', 'accountant')
  @AuditAction({ action: 'payroll.payment.added', entityType: 'PayrollPayment' })
  addPayment(@Body() dto: PayoutDto, @CurrentUser() user?: AuthenticatedUser) {
    return this.payroll.addPayment(dto, user?.id);
  }

  @Delete('payments/:id')
  @Roles('admin', 'accountant')
  @AuditAction({ action: 'payroll.payment.removed', entityType: 'PayrollPayment', idParam: 'id' })
  removePayment(@Param('id') id: string) {
    return this.payroll.removePayment(id);
  }

  /** Привязка сотрудника к нашей компании (СИЮ / ССЮ / Спортсет). */
  @Patch('people/:id')
  @Roles('admin', 'accountant')
  @AuditAction({ action: 'payroll.person.company', entityType: 'Person', idParam: 'id' })
  setCompany(@Param('id') id: string, @Body() dto: PersonCompanyDto) {
    return this.payroll.setCompany(id, dto.companyId);
  }
}
