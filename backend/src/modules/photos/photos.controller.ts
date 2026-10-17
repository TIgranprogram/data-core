import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuditAction } from '../../common/interceptors/audit.interceptor';
import { Roles } from '../../common/decorators/roles.decorator';
import {
  CreatePhotoDto,
  PhotosService,
  UpdatePhotoFrameDto,
  UploadedPhotoFile,
} from './photos.service';

@Controller('photos')
export class PhotosController {
  constructor(private readonly service: PhotosService) {}

  @Get()
  @Roles('admin', 'manager')
  findAll() {
    return this.service.findAll();
  }

  @Get(':id')
  @Roles('admin', 'manager', 'user')
  findOne(@Param('id') id: string) {
    return this.service.findById(id);
  }

  /** JSON-эндпоинт для регистрации уже загруженного URL (legacy). */
  @Post()
  @Roles('admin', 'manager')
  @AuditAction({ action: 'create', entityType: 'Photo' })
  create(@Body() dto: CreatePhotoDto) {
    return this.service.create(dto);
  }

  /**
   * Multipart upload. Поле формы: `file`. Сохраняет оригинал и отдельный
   * WebP-thumb в `./uploads`, возвращая original-поля в прежнем формате.
   */
  @Post('upload')
  @Roles('admin', 'manager')
  @UseInterceptors(FileInterceptor('file'))
  @AuditAction({ action: 'create', entityType: 'Photo' })
  async upload(@UploadedFile() file: UploadedPhotoFile) {
    if (!file) {
      throw new Error('No file uploaded (field name must be "file")');
    }
    const result = await this.service.upload(file);
    return {
      ...result.original.toObject(),
      variants: result.thumb ? { thumb: result.thumb } : {},
    };
  }

  /**
   * Сохранить кадр показа без перезагрузки файла (TZ-PHOTO-304).
   * Частичный merge: `{ frame: { posX?, posY?, fit? } }`.
   */
  @Patch(':id/frame')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'update', entityType: 'Photo', idParam: 'id' })
  async updateFrame(@Param('id') id: string, @Body() dto: UpdatePhotoFrameDto) {
    return this.service.updateFrame(id, dto);
  }

  @Delete(':id')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'delete', entityType: 'Photo', idParam: 'id' })
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string) {
    await this.service.remove(id);
  }
}
