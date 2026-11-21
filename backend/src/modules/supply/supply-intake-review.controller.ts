import {
  BadRequestException, Body, CanActivate, Controller, ExecutionContext, Get, Header, Headers, HttpCode, Injectable,
  Param, Post, Query, UploadedFile, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiHeader, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { isUUID } from 'class-validator';
import { memoryStorage } from 'multer';
import { AppSection } from '../../common/decorators/app-section.decorator';
import { AuditAction } from '../../common/decorators/audit-action.decorator';
import { CurrentUser, getAuthenticatedUser, type AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { StockScoped } from '../../common/decorators/stock-scoped.decorator';
import { stockScopeFor, type StockScope } from '../../common/stock-scope';
import { PDF_MIME } from '../photos/image-upload.options';
import { PhotoIntakeAccessGuard } from '../photos/photo-intake.controller';
import { InvoiceDraftId, InvoicePreparedResult, InvoiceReviewDto, InvoiceReviewResult, InvoiceReviewVersion, REVIEW_PDF_MAX_BYTES } from './dto-invoice-review';
import { SupplyInvoiceIntakeReceiptDto } from './dto-invoice-intake';
import { SupplyIntakeReviewService } from './supply-intake-review.service';

@Injectable()
export class ReviewUploadGuard implements CanActivate {
  constructor(private readonly review: SupplyIntakeReviewService) {}
  async canActivate(ctx: ExecutionContext) {
    const user = getAuthenticatedUser(ctx);
    const req = ctx.switchToHttp().getRequest();
    const draftId = req.query.draftId, ticket = req.headers['x-review-ticket'];
    if (!isUUID(draftId) || typeof ticket !== 'string' || !/^[a-f0-9]{64}$/.test(ticket)) throw new BadRequestException('Укажите проверку и подтверждение');
    await this.review.authorizeUpload({ draftId, ticket }, user.id, stockScopeFor(user), req.headers.host);
    return true;
  }
}

@ApiTags('Снабжение')
@AppSection('requests')
@Roles('admin', 'manager')
@UseGuards(PhotoIntakeAccessGuard)
@Controller('supply/invoices/intake')
export class SupplyIntakeReviewController {
  constructor(private readonly review: SupplyIntakeReviewService) {}

  @Post('review') @HttpCode(200) @Header('Cache-Control', 'no-store') @ApiOkResponse({ type: InvoiceReviewResult })
  @AuditAction({ action: 'supply.intake.review', entityType: 'SupplyIntakeReview' })
  save(@Body() input: InvoiceReviewDto, @CurrentUser() user: AuthenticatedUser, @StockScoped() scope: StockScope | null) {
    return this.review.review(input, user.id, scope);
  }
  @Get('review/:draftId') @Header('Cache-Control', 'no-store') @ApiOkResponse({ type: InvoiceReviewResult })
  read(@Param() id: InvoiceDraftId, @CurrentUser() user: AuthenticatedUser, @StockScoped() scope: StockScope | null) {
    return this.review.read(id.draftId, user.id, scope);
  }
  @Post('prepare') @HttpCode(200) @Header('Cache-Control', 'no-store') @ApiOkResponse({ type: InvoicePreparedResult })
  @AuditAction({ action: 'supply.intake.prepare', entityType: 'SupplyIntakeReview', details: () => ({ issued: true }) })
  prepare(@Body() input: InvoiceReviewVersion, @CurrentUser() user: AuthenticatedUser, @StockScoped() scope: StockScope | null, @Headers('host') host: string) {
    return this.review.prepare(input, user.id, scope, host);
  }
  @Post('commit') @HttpCode(200) @Header('Cache-Control', 'no-store') @UseGuards(ReviewUploadGuard)
  @ApiOkResponse({ type: SupplyInvoiceIntakeReceiptDto })
  @AuditAction({ action: 'supply.intake.commit', entityType: 'SupplyInvoice' })
  @ApiHeader({ name: 'X-Review-Ticket', required: true }) @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', required: ['file'], properties: { file: { type: 'string', format: 'binary' } } } })
  @UseInterceptors(FileInterceptor('file', {
    // Закрытый карантин в памяти. До повторной проверки не создаётся ни файла, ни PhotoDoc.
    // Multer обрывает чтение при достижении лимита. Допускаем ровно 15 МиБ.
    storage: memoryStorage(), limits: { files: 1, fields: 0, fileSize: REVIEW_PDF_MAX_BYTES + 1 },
    fileFilter: (_req, file, cb) => file.mimetype === PDF_MIME ? cb(null, true) : cb(new BadRequestException('Нужен PDF'), false),
  }))
  commit(@Query() id: InvoiceDraftId, @Headers('x-review-ticket') ticket: string, @UploadedFile() file: { buffer: Buffer } | undefined,
    @CurrentUser() user: AuthenticatedUser, @StockScoped() scope: StockScope | null, @Headers('host') host: string) {
    return this.review.commit({ draftId: id.draftId, ticket }, user.id, scope, host, file?.buffer);
  }
}
