import { Controller, Param, Post, Res, UseInterceptors } from '@nestjs/common';
import type { Response } from 'express';
import {
  CurrentUser,
  AuthenticatedUser,
} from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuditAction } from '../../common/decorators/audit-action.decorator';
import { RequireOrgScope } from '../../common/decorators/require-org-scope.decorator';
import { OrgScopeGuardInterceptor } from '../../common/interceptors/org-scope.interceptor';
import { QuotationOutputService } from './quotation-output.service';
import { buildKpPdfContentDisposition } from './kp-pdf-filename';

@RequireOrgScope()
@UseInterceptors(OrgScopeGuardInterceptor)
@Controller('quotations')
export class QuotationOutputController {
  constructor(private readonly output: QuotationOutputService) {}

  @Post(':id/pdf')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'generate_pdf', entityType: 'Quotation' })
  async pdf(
    @Param('id') id: string,
    @Res() res: Response,
    @CurrentUser() user?: AuthenticatedUser,
  ): Promise<void> {
    const rendered = await this.output.renderPdf(id, user);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      buildKpPdfContentDisposition(rendered.number, id),
    );
    res.send(rendered.buffer);
  }

  @Post(':id/generated-document')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'archive', entityType: 'Quotation' })
  archive(@Param('id') id: string, @CurrentUser() user?: AuthenticatedUser) {
    return this.output.archive(id, user);
  }
}
