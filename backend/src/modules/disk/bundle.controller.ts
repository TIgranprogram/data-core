import { ConflictException, Controller, Delete, Get, NotFoundException, Param, Post, Res, ServiceUnavailableException, BadRequestException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { createReadStream } from 'fs';
import type { Response } from 'express';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuditService } from '../audit/audit.service';
import { bundleFile, bundlesRoot, createBundleRequest, deleteBundle, isBundleName, listBundles, readBundleStatus, requestsRoot } from './bundle';

/**
 * Переносной пакет для переезда на другой сервер (bundle.sh на хосте). Приложение само его не собирает:
 * POST кладёт файл-запрос, cron хоста (bundle-watch.sh) собирает и пишет status.json.
 * Только admin: внутри пакета пароли и ключи (.env, дамп базы).
 */
@ApiTags('Сервер')
@Controller('health/bundle')
export class BundleController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @Roles('admin')
  async state() {
    const items = await listBundles(bundlesRoot());
    const status = await readBundleStatus(requestsRoot());
    return { mounted: items !== null, status, items: items ?? [] };
  }

  @Post()
  @Roles('admin')
  async request() {
    if ((await listBundles(bundlesRoot())) === null) throw new ServiceUnavailableException('Недоступно на этом сервере: папка пакетов не подключена');
    let r;
    try { r = await createBundleRequest(requestsRoot()); } catch { throw new ServiceUnavailableException('Недоступно на этом сервере: нельзя записать запрос на сборку'); }
    if (r === 'busy') throw new ConflictException('Пакет уже собирается или ждёт запуска на хосте');
    await this.audit.log({ action: 'bundle.request', entityType: 'Bundle' });
    return { ok: true, status: await readBundleStatus(requestsRoot()) };
  }

  @Get(':name/download')
  @Roles('admin')
  async download(@Param('name') name: string, @Res() res: Response) {
    if (!isBundleName(name)) throw new BadRequestException('Неверное имя пакета');
    const f = await bundleFile(bundlesRoot(), name);
    if (!f) throw new NotFoundException('Такого пакета нет на сервере');
    await this.audit.log({ action: 'bundle.download', entityType: 'Bundle', details: { meta: { name } } });
    res.set({
      'Content-Type': 'application/gzip',
      'Content-Length': String(f.bytes),
      'Content-Disposition': `attachment; filename="${name}"`,
      'Cache-Control': 'no-store',
      'Access-Control-Expose-Headers': 'Content-Disposition, Content-Length',
    });
    const rs = createReadStream(f.file);
    rs.on('error', () => res.destroy());
    res.on('close', () => rs.destroy());
    rs.pipe(res);
  }

  @Delete(':name')
  @Roles('admin')
  async remove(@Param('name') name: string) {
    if (!isBundleName(name)) throw new BadRequestException('Неверное имя пакета');
    const ok = await deleteBundle(bundlesRoot(), name);
    if (!ok) throw new NotFoundException('Пакет не найден');
    await this.audit.log({ action: 'bundle.delete', entityType: 'Bundle', details: { meta: { name } } });
    return { ok: true };
  }
}
