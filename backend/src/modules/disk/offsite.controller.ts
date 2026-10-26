import { Body, Controller, Delete, Get, Param, Patch, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuditService } from '../audit/audit.service';
import { OffsiteService } from './offsite';

/** БКП: копии вне дома — цели WebDAV, время, пароль шифрования. Только администратор; секреты наружу не отдаются. */
@ApiTags('Сервер')
@Controller('health/offsite')
export class OffsiteController {
  constructor(private readonly s: OffsiteService, private readonly audit: AuditService) {}

  @Get() @Roles('admin')
  view() { return this.s.view(); }

  @Put('settings') @Roles('admin')
  async settings(@Body() b: { time?: string; keep?: number; password?: string }) {
    await this.audit.log({ action: 'offsite.settings', entityType: 'Backup', details: { meta: { time: b?.time, keep: b?.keep, password: b?.password !== undefined ? 'изменён' : undefined } } });
    return this.s.saveSettings(b ?? {});
  }

  @Post('targets') @Roles('admin')
  async add(@Body() b: Record<string, unknown>) {
    await this.audit.log({ action: 'offsite.target.add', entityType: 'Backup', details: { meta: { name: b?.name, url: b?.url } } });
    return this.s.saveTarget(null, b ?? {});
  }

  @Patch('targets/:id') @Roles('admin')
  async edit(@Param('id') id: string, @Body() b: Record<string, unknown>) {
    await this.audit.log({ action: 'offsite.target.edit', entityType: 'Backup', entityId: id, details: { meta: { name: b?.name, url: b?.url, enabled: b?.enabled } } });
    return this.s.saveTarget(id, b ?? {});
  }

  @Delete('targets/:id') @Roles('admin')
  async remove(@Param('id') id: string) {
    await this.audit.log({ action: 'offsite.target.remove', entityType: 'Backup', entityId: id });
    return this.s.removeTarget(id);
  }

  @Post('targets/:id/test') @Roles('admin')
  test(@Param('id') id: string) { return this.s.test(id); }

  /** Отправить последнюю копию сейчас — во все включённые цели или в одну (?id). Долго: архив + выгрузка. */
  @Post('run') @Roles('admin')
  async run(@Body() b: { id?: string }) {
    await this.audit.log({ action: 'offsite.run', entityType: 'Backup', details: { meta: { id: b?.id } } });
    return this.s.runAll(b?.id);
  }
}
