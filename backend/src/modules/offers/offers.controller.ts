import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Res, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import { AppSection } from '../../common/decorators/app-section.decorator';
import { AuditAction } from '../../common/decorators/audit-action.decorator';
import { CurrentUser, type AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CreateOfferDto, OfferStatusDto, UpdateOfferDto, UploadBackgroundDto } from './dto';
import { BG_MAX_BYTES, BG_MIME, OfferBackgroundsService } from './offer-backgrounds.service';
import { OffersService } from './offers.service';

/** Коммерческие предложения. Смотреть — все роли с разделом «КП»; создавать, править, менять статус, загружать фоны — admin и manager. */
@ApiTags('КП')
@AppSection('offers')
@Controller('offers')
export class OffersController {
  constructor(private readonly offers: OffersService, private readonly bgs: OfferBackgroundsService) {}

  /** `{ items, total, page, limit, counts }`; фильтры `status`, `q`, `sort=-date`. */
  @Get()
  @Roles('admin', 'director', 'manager', 'user')
  list(@Query() q: Record<string, string>) {
    return this.offers.list(q);
  }

  // фоны — до `:id`, иначе «backgrounds» примется за id
  @Get('backgrounds')
  @Roles('admin', 'director', 'manager', 'user')
  backgrounds() {
    return this.bgs.list();
  }

  @Post('backgrounds')
  @Roles('admin', 'manager')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', {
    storage: memoryStorage(),
    limits: { fileSize: BG_MAX_BYTES, files: 1 },
    fileFilter: (_req, file, cb) => cb(null, BG_MIME.test(file.mimetype)),
  }))
  @AuditAction({ action: 'offer.background.created', entityType: 'CommercialOffer' })
  uploadBackground(@UploadedFile() file: { buffer: Buffer; mimetype: string; size: number } | undefined, @Body() dto: UploadBackgroundDto) {
    return this.bgs.upload(file, dto);
  }

  @Delete('backgrounds/:id')
  @HttpCode(200)
  @Roles('admin', 'manager')
  @AuditAction({ action: 'offer.background.deleted', entityType: 'CommercialOffer' })
  removeBackground(@Param('id') id: string) {
    return this.bgs.remove(id);
  }

  @Get(':id')
  @Roles('admin', 'director', 'manager', 'user')
  get(@Param('id') id: string) {
    return this.offers.get(id);
  }

  @Post()
  @Roles('admin', 'manager')
  @AuditAction({ action: 'offer.created', entityType: 'CommercialOffer' })
  create(@Body() dto: CreateOfferDto, @CurrentUser() user: AuthenticatedUser) {
    return this.offers.create(dto, user);
  }

  @Patch(':id')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'offer.updated', entityType: 'CommercialOffer', idParam: 'id' })
  update(@Param('id') id: string, @Body() dto: UpdateOfferDto) {
    return this.offers.update(id, dto);
  }

  /** Мягкое удаление. */
  @Delete(':id')
  @HttpCode(200)
  @Roles('admin', 'manager')
  @AuditAction({ action: 'offer.deleted', entityType: 'CommercialOffer', idParam: 'id' })
  remove(@Param('id') id: string) {
    return this.offers.remove(id);
  }

  /** Вернуть из корзины. */
  @Post(':id/restore')
  @HttpCode(200)
  @Roles('admin', 'manager')
  @AuditAction({ action: 'offer.restored', entityType: 'CommercialOffer', idParam: 'id' })
  restore(@Param('id') id: string) {
    return this.offers.restore(id);
  }

  /** Смена статуса: draft → sent → accepted → paid; rejected / cancelled — из любого, кроме paid. */
  @Post(':id/status')
  @HttpCode(200)
  @Roles('admin', 'manager')
  @AuditAction({ action: 'offer.status', entityType: 'CommercialOffer', idParam: 'id' })
  status(@Param('id') id: string, @Body() dto: OfferStatusDto, @CurrentUser() user: AuthenticatedUser) {
    return this.offers.setStatus(id, dto.status, user);
  }

  @Get(':id/pdf')
  @Roles('admin', 'director', 'manager', 'user')
  async pdf(@Param('id') id: string, @Res({ passthrough: true }) res: Response) {
    const r = await this.offers.pdf(id);
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="offer.pdf"; filename*=UTF-8''${encodeURIComponent(r.filename)}` });
    return new StreamableFile(r.buf);
  }
}
