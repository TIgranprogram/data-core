import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { FinancialReportService } from './financial-report.service';
import { GenerateFinancialReportDto } from './dto/generate-financial-report.dto';
import { UpdateFinancialReportDto } from './dto/update-financial-report.dto';
import { AuditAction } from '../../common/decorators/audit-action.decorator';

@Controller('financial-reports')
export class FinancialReportController {
  constructor(private readonly service: FinancialReportService) {}

  @Get()
  findAll(
    @Query('reportType') reportType?: string,
    @Query('periodStart') periodStart?: string,
    @Query('periodEnd') periodEnd?: string,
  ) {
    return this.service.findAll(
      reportType,
      periodStart ? new Date(periodStart) : undefined,
      periodEnd ? new Date(periodEnd) : undefined,
    );
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findById(id);
  }

  @Post('generate')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'generate', entityType: 'FinancialReport' })
  generate(@Body() dto: GenerateFinancialReportDto) {
    return this.service.generate(dto);
  }

  @Patch(':id')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'update', entityType: 'FinancialReport' })
  update(@Param('id') id: string, @Body() dto: UpdateFinancialReportDto) {
    return this.service.update(id, dto);
  }

  @Post(':id/export')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'export', entityType: 'FinancialReport' })
  export(@Param('id') id: string, @Query('format') format: 'pdf' | 'xlsx' = 'pdf') {
    return this.service.export(id, format);
  }

  @Delete(':id')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'delete', entityType: 'FinancialReport' })
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
