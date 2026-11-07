import { BadRequestException, Controller, Get, NotFoundException, Param, Query, Res } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import { ApiTags } from '@nestjs/swagger';
import archiver from 'archiver';
import type { Response } from 'express';
import { CurrentUser, type AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuditService } from '../audit/audit.service';
import { createReadStream } from 'fs';
import path from 'path';
import { backupReminder } from './backup-reminder';
import { archiveName, backupDirs, backupsRoot, backupTgz, isStamp, listBackups, parsePart } from './backups';

/** Резервные копии (cron backup.sh): список и скачивание ZIP «на лету». Только администратор и директор. */
@ApiTags('Сервер')
@Controller('health/backups')
export class BackupsController {
  constructor(private readonly audit: AuditService, @InjectConnection() private readonly connection: Connection) {}

  /** Напоминание при открытии админки: когда этот администратор скачал копию и сколько выпусков сайта вышло после. */
  @Get('reminder')
  @Roles('admin', 'director')
  reminder(@CurrentUser() user?: AuthenticatedUser) {
    return backupReminder(this.connection.db!, user?.id);
  }

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
    const tgz = await backupTgz(backupsRoot(), stamp);
    if (tgz) { // копия второго сервера — один архив, отдаём как есть
      await this.audit.log({ action: 'backup.download', entityType: 'Backup', details: { meta: { stamp, part: 'all' } } });
      res.set({ 'Content-Type': 'application/gzip', 'Content-Disposition': `attachment; filename="${path.basename(tgz)}"`, 'Cache-Control': 'no-store', 'Access-Control-Expose-Headers': 'Content-Disposition' });
      createReadStream(tgz).on('error', () => res.destroy()).pipe(res);
      return;
    }
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
