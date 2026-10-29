import { Body, Controller, Get, NotFoundException, Param, Patch, Post, Query, Res } from '@nestjs/common';
import archiver from 'archiver';
import type { Response } from 'express';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { DevlogService } from './devlog.service';
import { START_PROMPT } from './kit-prompt';
import { ImportDto, PatchItemDto, PatchSessionDto } from './dto/devlog.dto';

/** «История проекта» (DEVLOG): версии, время, ошибки, задачи, архив документов. Только admin. */
@ApiTags('История проекта')
@Controller('devlog')
@Roles('admin')
export class DevlogController {
  constructor(private readonly service: DevlogService) {}

  @Post('import')
  @ApiOperation({ summary: 'Идемпотентный импорт (скрипт devlog-import.js): коммиты, задачи, документы, ошибки' })
  @ApiResponse({ status: 201, description: '{ commits, items, errors, docs, sessions, releases } — сколько новых записей' })
  import(@Body() dto: ImportDto) {
    return this.service.importAll(dto);
  }

  @Get('releases')
  @ApiOperation({ summary: 'Версии с коммитами' })
  @ApiResponse({ status: 200, description: '{ items:[{ version, date, summary, commitCount, commits:[{hash,date,prefix,area,subject,place}] }], total, page, limit }' })
  releases(@Query() q: Record<string, unknown>) {
    return this.service.listReleases(q);
  }

  @Get('sessions')
  @ApiOperation({ summary: 'Сессии работы (?from&to=ГГГГ-ММ-ДД)' })
  @ApiResponse({ status: 200, description: '{ items:[{ id, start, end, day, hours, manualHours?, effectiveHours, commits, place }], total, page, limit }' })
  sessions(@Query() q: Record<string, unknown>) {
    return this.service.listSessions(q);
  }

  @Patch('sessions/:id')
  @ApiOperation({ summary: 'Ручная правка часов сессии (null — снять)' })
  patchSession(@Param('id') id: string, @Body() dto: PatchSessionDto) {
    return this.service.patchSession(id, dto);
  }

  @Get('stats')
  @ApiOperation({ summary: 'Часы по неделям, разделам, префиксам (?from&to&manual=1)' })
  @ApiResponse({ status: 200, description: '{ manual, totalHours, sessions, commits, byWeek:[{week,hours}], byArea:[{area,hours}], byPrefix:[{prefix,hours}], note }' })
  stats(@Query() q: Record<string, unknown>) {
    return this.service.stats(q);
  }

  @Get('items')
  @ApiOperation({ summary: 'Ошибки и задачи (?type=error|task&status&area&search)' })
  @ApiResponse({ status: 200, description: '{ items:[{ id, key, type, title, area, status, count?, firstAt?, lastAt?, version?, returned?, refs?, note?, hours?, manual }], total, page, limit }' })
  items(@Query() q: Record<string, unknown>) {
    return this.service.listItems(q);
  }

  @Patch('items/:id')
  @ApiOperation({ summary: 'Ручная пометка: статус, «исправлена в vN», примечание, часы (запись становится manual)' })
  patchItem(@Param('id') id: string, @Body() dto: PatchItemDto) {
    return this.service.patchItem(id, dto);
  }

  @Get('docs')
  @ApiOperation({ summary: 'Архив документов: список без текста (?search&kind&path=)' })
  @ApiResponse({ status: 200, description: '{ items:[{ id, path, title, kind, sha256, importedAt, closedAt }], total, page, limit }; ?path= — точное совпадение для сверки sha256' })
  docs(@Query() q: Record<string, unknown>) {
    return this.service.listDocs(q);
  }

  @Get('kit/download')
  @ApiOperation({ summary: 'Набор для нового проекта: zip из снимка файлов процесса + START-PROMPT.md' })
  @ApiResponse({ status: 200, description: 'application/zip' })
  @ApiResponse({ status: 404, description: 'Снимка нет — сначала импорт' })
  async kitDownload(@Res() res: Response) {
    const files = await this.service.kitFiles();
    if (!files.length) throw new NotFoundException('Набор пуст: сначала запустите импорт');
    res.set({
      'Content-Type': 'application/zip',
      'Content-Disposition': 'attachment; filename="process-kit.zip"',
      'Access-Control-Expose-Headers': 'Content-Disposition',
    });
    const zip = archiver('zip', { zlib: { level: 6 } });
    zip.on('error', () => res.destroy());
    res.on('close', () => zip.destroy());
    zip.pipe(res);
    zip.append(START_PROMPT, { name: 'START-PROMPT.md' });
    for (const f of files) zip.append(f.text, { name: f.path });
    await zip.finalize();
  }

  @Get('docs/:id')
  @ApiOperation({ summary: 'Документ архива с текстом' })
  doc(@Param('id') id: string) {
    return this.service.getDoc(id);
  }
}
