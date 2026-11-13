import { Controller, Get, HttpCode, Param, Post, Query, Req, Res } from '@nestjs/common';
import { ApiQuery, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { createReadStream } from 'fs';
import { AppSection } from '../../common/decorators/app-section.decorator';
import { CurrentUser, type AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { contentDisposition, parseRange } from '../productattachments/attachment-paths';
import { PdmFilesService } from './pdm-files.service';

type FileInfo = { abs: string; size: number; name: string };

/** Отдать файл: только скачивание (PDF/DXF не открываются в окне сайта), поддержка `Range`. */
function send(f: FileInfo, req: Request, res: Response): void {
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

/** Файлы из PDM (чертежи, развёртки). Читают те же роли, что изделия; записывает только сервис импорта. */
@ApiTags('Файлы PDM')
@AppSection('products')
@Controller('pdm-files')
export class PdmFilesController {
  constructor(private readonly service: PdmFilesService) {}

  @Get()
  @Roles('admin', 'director', 'manager', 'user')
  @ApiQuery({ name: 'ownerKind', required: true, enum: ['product', 'module', 'material'] })
  @ApiQuery({ name: 'ownerId', required: true })
  list(@Query('ownerKind') ownerKind: string, @Query('ownerId') ownerId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.list(ownerKind, ownerId, user.organizationId);
  }

  /** Скачать с заголовком авторизации (клиенты API). Поле `url` в списке ведёт сюда. */
  @Get(':id/download')
  @Roles('admin', 'director', 'manager', 'user')
  async download(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser, @Req() req: Request, @Res() res: Response) {
    send(await this.service.file(id, user.organizationId), req, res);
  }

  /** `{ticket, expiresIn, url}`: одноразовая ссылка для браузера живёт 60 секунд. */
  @Post(':id/download-ticket')
  @HttpCode(200)
  @Roles('admin', 'director', 'manager', 'user')
  ticket(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.ticket(id, user?.id ?? '', user.organizationId);
  }
}

/** Скачивание по тикету: обычная ссылка не шлёт авторизацию, поэтому @Public; доступ даёт только тикет. */
@ApiTags('Файлы PDM')
@Public()
@Controller('pdm-files')
export class PdmFileByTicketController {
  constructor(private readonly service: PdmFilesService) {}

  @Get(':id/file')
  async file(@Param('id') id: string, @Query('t') t: string, @Req() req: Request, @Res() res: Response) {
    send(await this.service.fileByTicket(id, t), req, res);
  }
}
