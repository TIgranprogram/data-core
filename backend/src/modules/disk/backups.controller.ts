import { BadRequestException, Controller, Get, NotFoundException, Param, Query, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import archiver from 'archiver';
import type { Response } from 'express';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuditService } from '../audit/audit.service';
import { archiveName, backupDirs, backupsRoot, isStamp, listBackups, parsePart } from './backups';

/** Резервные копии (cron backup.sh): список и скачивание ZIP «на лету». Только администратор и директор. */
@ApiTags('Сервер')
@Controller('health/backups')
export class BackupsController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @Roles('admin', 'director')
  async list() {
    const items = await listBackups(backupsRoot());
    return { mounted: items !== null, items: items ?? [] };
  }

  @Get(':stamp/download')
  @Roles('admin', 'director')
  async download(@Param('stamp') stamp: string, @Query('part') partRaw: string | undefined, @Res() res: Response) {
    const part = parsePart(partRaw);
    if (!isStamp(stamp) || !part) throw new BadRequestException('Неверная копия или часть (mongo, uploads, all)');
    const dirs = await backupDirs(backupsRoot(), stamp, part);
    if (!dirs.length) throw new NotFoundException('Такой копии нет на сервере');
    await this.audit.log({ action: 'backup.download', entityType: 'Backup', details: { meta: { stamp, part } } });
    res.set({
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${archiveName(stamp, part)}"`,
      'Cache-Control': 'no-store',
      'Access-Control-Expose-Headers': 'Content-Disposition',
    });
    const zip = archiver('zip', { zlib: { level: 1 } }); // фото уже сжаты — быстрый уровень
    zip.on('error', () => res.destroy());
    res.on('close', () => zip.destroy());
    zip.pipe(res);
    for (const [dir, inside] of dirs) zip.directory(dir, inside);
    await zip.finalize();
  }
}
