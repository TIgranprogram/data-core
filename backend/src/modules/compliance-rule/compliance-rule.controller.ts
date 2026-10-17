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
import { ComplianceRuleService } from './compliance-rule.service';
import { CreateComplianceRuleDto } from './dto/create-compliance-rule.dto';
import { UpdateComplianceRuleDto } from './dto/update-compliance-rule.dto';
import { AuditAction } from '../../common/decorators/audit-action.decorator';

@Controller('compliance-rules')
export class ComplianceRuleController {
  constructor(private readonly service: ComplianceRuleService) {}

  @Get()
  findAll(@Query('sourceType') sourceType?: string, @Query('targetType') targetType?: string) {
    return this.service.findAll(sourceType, targetType);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findById(id);
  }

  @Post()
  @Roles('admin', 'manager')
  @AuditAction({ action: 'create', entityType: 'ComplianceRule' })
  create(@Body() dto: CreateComplianceRuleDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'update', entityType: 'ComplianceRule' })
  update(@Param('id') id: string, @Body() dto: UpdateComplianceRuleDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'delete', entityType: 'ComplianceRule' })
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
