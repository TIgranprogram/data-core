import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Roles } from '../../common/decorators/roles.decorator';
import { TemplateBlockService } from './template-block.service';
import { CreateTemplateBlockOnTemplateDto } from './dto/create-template-block.dto';
import { UpdateTemplateBlockDto } from './dto/update-template-block.dto';
import { ReorderBlocksDto } from './dto/reorder-blocks.dto';
import { UpdateTemplateBlockLayoutsDto } from './dto/update-layouts.dto';
import { AuditAction } from '../../common/decorators/audit-action.decorator';

@Controller()
export class TemplateBlockController {
  constructor(private readonly service: TemplateBlockService) {}

  @Get('template-blocks')
  findAll(@Query('templateId') templateId?: string) {
    return this.service.findAll(templateId);
  }

  @Get('template-blocks/:id')
  findOne(@Param('id') id: string) {
    return this.service.findById(id);
  }

  @Post('document-templates/:id/blocks')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'create', entityType: 'TemplateBlock' })
  add(@Param('id') templateId: string, @Body() dto: CreateTemplateBlockOnTemplateDto) {
    return this.service.create({ ...dto, templateId });
  }

  @Patch('document-templates/:id/blocks/layouts')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'update-layouts', entityType: 'TemplateBlock' })
  updateLayouts(@Param('id') templateId: string, @Body() dto: UpdateTemplateBlockLayoutsDto) {
    return this.service.updateLayouts(templateId, dto);
  }

  @Post('document-templates/:id/blocks/reorder')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'reorder', entityType: 'TemplateBlock' })
  reorder(@Param('id') templateId: string, @Body() dto: ReorderBlocksDto) {
    return this.service.reorder(templateId, dto.blockIds);
  }

  /**
   * TZ-DOC-333 — persist a photo for an image block (mirror of
   * DocumentTemplate upload-background).
   *
   * Multipart contract:
   *   - URL:    POST /api/template-blocks/:id/image
   *   - Field:  `file` (mandatory; required by FileInterceptor)
   *   - Limits: fileSize ≤ 5 MB, files ≤ 1, MIME ∈ {image/png, image/jpeg, image/webp}
   *
   * Response: `{ url: '/uploads/template-blocks/{id}/{uuid}.{ext}' }`.
   *
   * Validation:
   *   - FileFilter rejects non-whitelisted MIMEs → 400.
   *   - limit.fileSize → MulterError('LIMIT_FILE_SIZE') → MulterExceptionFilter → 413.
   *   - Block not found → 404 (TemplateBlockService.findById throws).
   *
   * Storage: memoryStorage() so the buffer is validated in the service before
   * writing under `uploads/template-blocks/{id}/` — same pattern as the
   * background reference; main.ts `useStaticAssets` serves `/uploads/*`.
   */
  @Post('template-blocks/:id/image')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'upload_image', entityType: 'TemplateBlock', idParam: 'id' })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      fileFilter: (_req, file, cb) => {
        const allowed = ['image/png', 'image/jpeg', 'image/webp'];
        if (!allowed.includes(file.mimetype)) {
          return cb(
            new BadRequestException(
              `Недопустимый MIME-тип файла: ${file.mimetype}. Разрешено: image/png | image/jpeg | image/webp.`,
            ),
            false,
          );
        }
        cb(null, true);
      },
      limits: { fileSize: 5 * 1024 * 1024, files: 1 },
    }),
  )
  async uploadImage(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ): Promise<{ url: string }> {
    if (!file) {
      throw new BadRequestException(
        'Файл не получен. Выберите PNG, JPEG или WebP (поле «file»).',
      );
    }
    return this.service.uploadImage(id, file);
  }

  @Patch('template-blocks/:id')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'update', entityType: 'TemplateBlock' })
  update(@Param('id') id: string, @Body() dto: UpdateTemplateBlockDto) {
    return this.service.update(id, dto);
  }

  @Delete('template-blocks/:id')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'delete', entityType: 'TemplateBlock' })
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
