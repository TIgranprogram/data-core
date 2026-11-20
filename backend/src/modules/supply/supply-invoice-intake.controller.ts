import { Body, Controller, ForbiddenException, Get, Header, HttpCode, Param, Post } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { AppSection } from '../../common/decorators/app-section.decorator';
import { AuditAction } from '../../common/decorators/audit-action.decorator';
import { CurrentUser, type AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { StockScoped } from '../../common/decorators/stock-scoped.decorator';
import { canSeeMoney } from '../../common/roles-hierarchy';
import type { StockScope } from '../../common/stock-scope';
import { SupplyInvoiceIntakeDto, SupplyInvoiceIntakeParamDto, SupplyInvoiceIntakeReceiptDto } from './dto-invoice-intake';
import { SupplyInvoiceIntakeService } from './supply-invoice-intake.service';

@ApiTags('Снабжение')
@AppSection('requests')
@Controller('supply/invoices/intake')
export class SupplyInvoiceIntakeController {
  constructor(private readonly intake: SupplyInvoiceIntakeService) {}

  @Post()
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @Roles('admin', 'manager')
  @ApiOkResponse({ type: SupplyInvoiceIntakeReceiptDto })
  @AuditAction({ action: 'supply.invoice.intake', entityType: 'SupplyInvoice' })
  import(@Body() dto: SupplyInvoiceIntakeDto, @StockScoped() scope: StockScope | null, @CurrentUser() user: AuthenticatedUser) {
    if (!canSeeMoney(user)) throw new ForbiddenException('Для загрузки счёта нужен доступ к денежным данным');
    return this.intake.import(dto, user.id, scope);
  }

  @Get(':uid')
  @Header('Cache-Control', 'no-store')
  @Roles('admin', 'manager')
  @ApiOkResponse({ type: SupplyInvoiceIntakeReceiptDto })
  receipt(@Param() { uid }: SupplyInvoiceIntakeParamDto, @StockScoped() scope: StockScope | null, @CurrentUser() user: AuthenticatedUser) {
    if (!canSeeMoney(user)) throw new ForbiddenException('Для сверки счёта нужен доступ к денежным данным');
    return this.intake.receipt(uid, user.id, scope);
  }
}
