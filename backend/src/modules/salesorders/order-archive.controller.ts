import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Query, Res, StreamableFile } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { AppSection } from '../../common/decorators/app-section.decorator';
import { CurrentUser, type AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { contentDisposition } from '../productattachments/attachment-paths';
import { ArchiveCloseCommand, ArchiveCommand } from './order-archive.dto';
import { OrderArchiveService } from './order-archive.service';

@ApiTags('Архив договоров')
@AppSection('salesorders')
@Controller('salesorders/:id/archive')
export class OrderArchiveController {
  constructor(private readonly archive: OrderArchiveService) {}

  @Get() @Roles('admin', 'user')
  history(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.archive.history(id, actor);
  }
  @Get('readiness') @Roles('admin', 'manager')
  readiness(@Param('id') id: string, @Query('evidenceDocumentUid') evidence: string | undefined, @CurrentUser() actor: AuthenticatedUser) {
    return this.archive.readiness(id, evidence, actor);
  }
  @Post() @HttpCode(200) @Roles('admin', 'manager')
  close(@Param('id') id: string, @Body() dto: ArchiveCloseCommand, @CurrentUser() actor: AuthenticatedUser) {
    return this.archive.close(id, dto, actor);
  }
  @Post('reopen') @HttpCode(200) @Roles('admin')
  reopen(@Param('id') id: string, @Body() dto: ArchiveCommand, @CurrentUser() actor: AuthenticatedUser) {
    return this.archive.reopen(id, dto, actor);
  }
  @Get(':version') @Roles('admin', 'user')
  detail(@Param('id') id: string, @Param('version', ParseIntPipe) version: number, @CurrentUser() actor: AuthenticatedUser) {
    return this.archive.detail(id, version, actor);
  }
  @Get(':version/files/:fileId') @Roles('admin', 'user')
  async download(@Param('id') id: string, @Param('version', ParseIntPipe) version: number, @Param('fileId') fileId: string,
    @CurrentUser() actor: AuthenticatedUser, @Res({ passthrough: true }) res: Response) {
    const { file, bytes } = await this.archive.download(id, version, fileId, actor);
    res.set({ 'Content-Type': file.mime, 'Content-Disposition': contentDisposition(file.name), 'Cache-Control': 'private, no-store' });
    return new StreamableFile(bytes);
  }
}
