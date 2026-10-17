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
import { InvoiceService } from './invoice.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { UpdateInvoiceDto } from './dto/update-invoice.dto';
import { MarkPaidDto } from './dto/mark-paid.dto';
import { AuditAction } from '../../common/decorators/audit-action.decorator';

@Controller()
export class InvoiceController {
  constructor(private readonly service: InvoiceService) {}

  @Get('invoices/overdue')
  overdue() {
    return this.service.findOverdue();
  }

  @Post('invoices')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'create', entityType: 'Invoice' })
  create(@Body() dto: CreateInvoiceDto) {
    return this.service.create(dto);
  }

  @Get('invoices')
  findAll(
    @Query('supplierId') supplierId?: string,
    @Query('status') status?: string,
    @Query('paid') paid?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.service.findAll(
      supplierId,
      status,
      paid === undefined ? undefined : paid === 'true' || paid === '1',
      from ? new Date(from) : undefined,
      to ? new Date(to) : undefined,
    );
  }

  @Get('invoices/:id')
  findOne(@Param('id') id: string) {
    return this.service.findById(id);
  }

  @Patch('invoices/:id')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'update', entityType: 'Invoice' })
  update(@Param('id') id: string, @Body() dto: UpdateInvoiceDto) {
    return this.service.update(id, dto);
  }

  @Post('invoices/:id/mark-paid')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'mark_paid', entityType: 'Invoice' })
  markPaid(@Param('id') id: string, @Body() dto: MarkPaidDto) {
    return this.service.markPaid(id, dto);
  }

  @Delete('invoices/:id')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'delete', entityType: 'Invoice' })
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
