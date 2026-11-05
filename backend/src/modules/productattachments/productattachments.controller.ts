import { Controller, Delete, Get, HttpCode, Param, Post, Query, Req, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { createReadStream } from 'fs';
import { AppSection } from '../../common/decorators/app-section.decorator';
import { CurrentUser, type AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuditAction } from '../../common/interceptors/audit.interceptor';
import { contentDisposition, parseRange } from './attachment-paths';
import { AttachmentUploadGuard } from './attachment-upload.guard';
import { attachmentUploadOptions } from './attachment-upload.options';
import { OrderAttachmentsService } from './order-attachments.service';
import { ProductAttachmentsService, type UploadedAttachmentFile } from './productattachments.service';

type Row = { id?: string; originalName?: string; typeName?: string; size?: number };
const info = (d: unknown) => { const r = (d ?? {}) as Row; return { name: r.originalName, type: r.typeName, size: r.size }; };

/** Вложения изделия (ВЛ-1): `/api/products/:id/attachments`. Загружают admin и manager, смотрят все, удаляет только admin. */
@ApiTags('Вложения изделия')
@AppSection('products')
@Controller('products/:id/attachments')
export class ProductAttachmentsController {
  constructor(private readonly service: ProductAttachmentsService) {}

  /** `{items,total,page,limit}`; без `storedPath`. `?deleted=1` (admin) — убранные файлы. */
  @Get()
  @Roles('admin', 'director', 'manager', 'user')
  list(@Param('id') id: string, @Query('deleted') deleted: string | undefined, @CurrentUser() user: AuthenticatedUser) {
    return this.service.list(id, deleted === '1' && user?.role === 'admin');
  }

  /** Multipart: поле `file`, вид — `?typeId=`. Лимит — `ATTACHMENT_MAX_BYTES` (512 МБ). */
  @Post()
  @Roles('admin', 'manager')
  @Throttle({ short: { ttl: 60_000, limit: 60 } })
  @UseGuards(AttachmentUploadGuard)
  @UseInterceptors(FileInterceptor('file', attachmentUploadOptions))
  @AuditAction({ action: 'attachment.created', entityType: 'ProductAttachment', details: (d) => info(d) })
  upload(@Param('id') id: string, @Query('typeId') typeId: string, @UploadedFile() file: UploadedAttachmentFile, @CurrentUser() user: AuthenticatedUser) {
    return this.service.save(file, id, typeId, user);
  }

  /** Только администратор. Мягкое удаление: из списка пропадает, файл на диске стирается позже. */
  @Delete(':aid')
  @Roles('admin')
  @AuditAction({ action: 'attachment.deleted', entityType: 'ProductAttachment', idParam: 'aid', details: (d) => info(d) })
  remove(@Param('id') id: string, @Param('aid') aid: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.remove(id, aid, user);
  }

  @Post(':aid/restore')
  @HttpCode(200)
  @Roles('admin')
  @AuditAction({ action: 'attachment.restored', entityType: 'ProductAttachment', idParam: 'aid', details: (d) => info(d) })
  restore(@Param('id') id: string, @Param('aid') aid: string) {
    return this.service.restore(id, aid);
  }

  /** `{ticket, expiresIn}`: одноразовая ссылка на скачивание живёт 60 секунд. */
  @Post(':aid/download-ticket')
  @HttpCode(200)
  @Roles('admin', 'director', 'manager', 'user')
  ticket(@Param('id') id: string, @Param('aid') aid: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.ticket(id, aid, user).then((t) => ({ ...t, url: `/api/products/${id}/attachments/${aid}/file?t=${t.ticket}` }));
  }
}

/**
 * Скачивание по тикету: без заголовка авторизации (работает обычная ссылка `<a href>`), поэтому @Public;
 * доступ даёт только тикет. Файл стримится с диска, поддерживается `Range` (докачка).
 */
@ApiTags('Вложения изделия')
@Public()
@Controller('products/:id/attachments')
export class ProductAttachmentFileController {
  constructor(private readonly service: ProductAttachmentsService) {}

  @Get(':aid/file')
  async file(@Param('id') id: string, @Param('aid') aid: string, @Query('t') t: string, @Req() req: Request, @Res() res: Response) {
    const f = await this.service.fileByTicket(id, aid, t);
    const range = parseRange(req.headers.range, f.size);
    res.set({
      'Content-Type': 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': 'sandbox',
      'Content-Disposition': contentDisposition(f.name), 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, no-store',
    });
    if (range === 'bad') { res.status(416).set('Content-Range', `bytes */${f.size}`).end(); return; }
    const part = range ?? { start: 0, end: f.size - 1 };
    if (range) res.status(206).set('Content-Range', `bytes ${range.start}-${range.end}/${f.size}`);
    res.set('Content-Length', String(f.size ? part.end - part.start + 1 : 0));
    if (!f.size) { res.end(); return; }
    const stream = createReadStream(f.abs, part);
    res.on('close', () => stream.destroy());
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  }
}

/** ZIP вложений по заказу (ВЛ-1): `?types=<id,id>` — виды вложений. Скачивание — по одноразовому тикету, как у файла. */
@ApiTags('Вложения изделия')
@AppSection('salesorders')
@Controller('salesorders/:id/attachments')
export class OrderAttachmentsController {
  constructor(private readonly service: OrderAttachmentsService) {}

  /** `{files, bytes, skipped, tooBig}` — «N файлов, X МБ» до скачивания. */
  @Get('summary')
  @Roles('admin', 'director', 'manager', 'user')
  summary(@Param('id') id: string, @Query('types') types?: string) {
    return this.service.summary(id, types);
  }

  /** `{ticket, url, files, bytes}`; в журнал — одна строка (заказ, число файлов). */
  @Post('zip-ticket')
  @HttpCode(200)
  @Roles('admin', 'director', 'manager', 'user')
  @AuditAction({ action: 'attachment.zip', entityType: 'SalesOrder', idParam: 'id', details: (d) => { const r = (d ?? {}) as { orderNo?: string; files?: number; bytes?: number }; return { orderNo: r.orderNo, files: r.files, bytes: r.bytes }; } })
  zipTicket(@Param('id') id: string, @Query('types') types: string | undefined, @CurrentUser() user: AuthenticatedUser) {
    return this.service.ticket(id, types, user);
  }
}

/** Сам архив: без заголовка авторизации (обычная ссылка), доступ даёт тикет. Не более 2 сборок одновременно. */
@ApiTags('Вложения изделия')
@Public()
@Controller('salesorders/:id')
export class OrderAttachmentsZipController {
  constructor(private readonly service: OrderAttachmentsService) {}

  @Get('attachments.zip')
  async zip(@Param('id') id: string, @Query('types') types: string | undefined, @Query('t') t: string, @Res() res: Response) {
    await this.service.stream(id, types, t, res);
  }
}
