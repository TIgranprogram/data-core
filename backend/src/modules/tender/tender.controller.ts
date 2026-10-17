import {
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
import { TenderService } from './tender.service';
import { CreateTenderDto } from './dto/create-tender.dto';
import { UpdateTenderDto } from './dto/update-tender.dto';
import { WinTenderDto } from './dto/win-tender.dto';
import { AuditAction } from '../../common/decorators/audit-action.decorator';
import { IsObjectId } from '../../common/decorators/is-object-id.decorator';
import { RequireOrgScope } from '../../common/decorators/require-org-scope.decorator';
import { OrgScopeGuardInterceptor } from '../../common/interceptors/org-scope.interceptor';

class AttachQuoteDto {
  @IsObjectId() quoteId!: string;
}

@RequireOrgScope()
@UseInterceptors(OrgScopeGuardInterceptor)
@Controller()
export class TenderController {
  constructor(private readonly service: TenderService) {}

  @Get('tenders/expiring')
  expiring(@Query('days') days?: string) {
    const n = days ? parseInt(days, 10) : 7;
    return this.service.findExpiring(Number.isFinite(n) ? n : 7);
  }

  @Post('tenders')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'create', entityType: 'Tender' })
  create(@Body() dto: CreateTenderDto) {
    return this.service.create(dto);
  }

  @Get('tenders')
  findAll(@Query('status') status?: string) {
    return this.service.findAll(status);
  }

  @Get('tenders/:id')
  findOne(@Param('id') id: string) {
    return this.service.findById(id);
  }

  @Patch('tenders/:id')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'update', entityType: 'Tender' })
  update(@Param('id') id: string, @Body() dto: UpdateTenderDto) {
    return this.service.update(id, dto);
  }

  @Post('tenders/:id/quotes')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'attach_quote', entityType: 'Tender' })
  attachQuote(@Param('id') id: string, @Body() dto: AttachQuoteDto) {
    return this.service.attachQuote(id, dto.quoteId);
  }

  @Post('tenders/:id/win')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'win', entityType: 'Tender' })
  win(@Param('id') id: string, @Body() dto: WinTenderDto) {
    return this.service.win(id, dto);
  }

  @Delete('tenders/:id')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'delete', entityType: 'Tender' })
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
