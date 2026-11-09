import { BadRequestException, Body, Controller, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser, type AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuditAction } from '../../common/interceptors/audit.interceptor';
import { decodeMulterOriginalName } from '../photos/image-upload.options';
import { PDM_MAX_BYTES } from '../pdm-files/pdm-paths';
import { PdmApplyDto, PdmFileFormDto, PdmTreeDto } from './dto/pdm-tree.dto';
import { PdmImportService } from './pdm-import.service';

/** Загрузка изделий из PDM (C057): предпросмотр → применение → файлы. Только администратор. Формат — docs/crew/C057-pdm-import/CONTRACT.md. */
@ApiTags('Загрузка из PDM')
@Controller('pdm-import')
export class PdmImportController {
  constructor(private readonly service: PdmImportService) {}

  @Post('preview')
  @Roles('admin')
  @ApiOperation({ summary: 'Сравнить дерево pdm-tree/1 с сайтом: что создать, что связать, где расхождения (ничего не записывает в номенклатуру)' })
  preview(@Body() tree: PdmTreeDto, @CurrentUser() user: AuthenticatedUser) {
    return this.service.preview(tree, user);
  }

  @Post('apply')
  @Roles('admin')
  @AuditAction({ action: 'create', entityType: 'PdmImport', details: (data) => { const r = (data ?? {}) as Record<string, unknown>; return { importId: r.importId, created: r.created, updated: r.updated }; } })
  @ApiOperation({ summary: 'Записать план одной транзакцией. Повтор того же planId возвращает прежний итог; 409, если данные на сайте изменились' })
  apply(@Body() dto: PdmApplyDto, @CurrentUser() user: AuthenticatedUser) {
    return this.service.apply(dto, user);
  }

  /** Multipart: поле `file` (PDF/DXF до 50 МБ) и поля формы из CONTRACT §3. Повтор того же файла — `stored:false`. */
  @Post('files')
  @Roles('admin')
  @Throttle({ short: { ttl: 60_000, limit: 600 } })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: PDM_MAX_BYTES, files: 1 } }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  files(@UploadedFile() file: Express.Multer.File | undefined, @Body() form: PdmFileFormDto, @CurrentUser() user: AuthenticatedUser) {
    if (!file) throw new BadRequestException('Файл не передан (поле формы file)');
    file.originalname = decodeMulterOriginalName(file.originalname);
    return this.service.saveFile(form, file.buffer, user);
  }
}
