import { Controller, Get, Header, StreamableFile } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { AppsService, PDM_LOADER_FILE } from './apps.service';

/** Приложения для скачивания (администратору). */
@ApiTags('Приложения')
@Controller('apps')
export class AppsController {
  constructor(private readonly service: AppsService) {}

  @Get('pdm-loader')
  @Roles('admin')
  info() {
    return this.service.info();
  }

  @Get('pdm-loader/download')
  @Roles('admin')
  @Header('Content-Type', 'application/octet-stream')
  @Header('X-Content-Type-Options', 'nosniff')
  @Header('Content-Disposition', `attachment; filename="${PDM_LOADER_FILE}"`)
  async download() {
    const { stream, size } = await this.service.open();
    return new StreamableFile(stream, { length: size });
  }
}
