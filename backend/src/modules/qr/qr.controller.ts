import { Body, Controller, Get, HttpCode, Param, Post, Res, StreamableFile } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { AppSection } from '../../common/decorators/app-section.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { QrPrintDto } from './dto';
import { QrService } from './qr.service';

/** QR-коды позиций склада и изделий. Читать и печатать — admin, director, manager, user; цен в ответах нет. */
@ApiTags('QR-коды')
@AppSection('stock', 'products')
@Controller('qr')
export class QrController {
  constructor(private readonly qr: QrService) {}

  /** PDF наклеек 5×7 на А4. `{items:[{type:'S'|'P'|'M', id}], skip?}` ≤ 350; коды выдаются при печати. */
  @Post('print')
  @HttpCode(200)
  @Roles('admin', 'director', 'manager', 'user')
  async print(@Body() dto: QrPrintDto, @Res({ passthrough: true }) res: Response) {
    const buf = await this.qr.print(dto.items, dto.skip ?? 0);
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline; filename="qr.pdf"' });
    return new StreamableFile(buf);
  }

  /** `{entityType, id, name, article, deleted}`; неверный формат кода — 400, неизвестный — 404. */
  @Get(':code')
  @Roles('admin', 'director', 'manager', 'user')
  get(@Param('code') code: string) {
    return this.qr.resolve(code);
  }
}

/** Публичный адрес из наклейки: `/q/<код>` (без /api) → приложение. Относительный: за nginx это `/db/q/…` → `/db/app/`. */
@ApiTags('QR-коды')
@Public()
@Controller('q')
export class QrRedirectController {
  @Get(':code')
  redirect(@Param('code') code: string, @Res() res: Response) {
    if (!/^[A-Za-z0-9-]{1,20}$/.test(code)) return res.status(400).send('Неверный QR-код');
    return res.redirect(302, `../app/#q=${code.toUpperCase()}`);
  }
}
