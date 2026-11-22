import {
  BadRequestException, Controller, Delete, ForbiddenException, Get, Header, Param, ParseUUIDPipe, Post,
  StreamableFile, UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiProperty, ApiPropertyOptional, ApiProduces, ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { DESK_FILE_BYTES, DeskFilesService } from './desk-files.service';

class DeskFileDto {
  @ApiProperty({ pattern: '^[a-f0-9]{24}$' }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ type: 'integer' }) size!: number;
  @ApiProperty({ format: 'date-time' }) uploadedAt!: Date;
  @ApiPropertyOptional({ format: 'date-time' }) deletedAt?: Date;
}

function owner(me: AuthenticatedUser) {
  if (me.keyScope) throw new ForbiddenException('Рабочий стол доступен из приложения');
  return me.id;
}

function validFileId(value: string) {
  if (!/^[0-9a-f]{24}$/i.test(value)) throw new BadRequestException('Недопустимый код файла');
  return value;
}

@ApiTags('Auth')
@Roles('user')
@Controller('auth/me/desk/tasks/:taskId/files')
export class DeskFilesController {
  constructor(private readonly files: DeskFilesService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'Показать файлы своей задачи' })
  @ApiOkResponse({ type: [DeskFileDto] })
  list(@CurrentUser() me: AuthenticatedUser, @Param('taskId', new ParseUUIDPipe({ version: '4' })) taskId: string) {
    return this.files.list(owner(me), taskId);
  }

  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: DESK_FILE_BYTES, files: 1, fields: 0 } }))
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'Прикрепить файл к своей задаче' })
  @ApiCreatedResponse({ type: DeskFileDto })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', required: ['file'], properties: { file: { type: 'string', format: 'binary' } } } })
  upload(
    @CurrentUser() me: AuthenticatedUser,
    @Param('taskId', new ParseUUIDPipe({ version: '4' })) taskId: string,
    @UploadedFile() file?: { originalname: string; buffer: Buffer },
  ) {
    return this.files.upload(owner(me), taskId, file);
  }

  @Get(':fileId')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  @ApiOperation({ summary: 'Скачать файл своей задачи' })
  @ApiProduces('application/octet-stream')
  @ApiOkResponse({ schema: { type: 'string', format: 'binary' } })
  async download(
    @CurrentUser() me: AuthenticatedUser,
    @Param('taskId', new ParseUUIDPipe({ version: '4' })) taskId: string,
    @Param('fileId') fileId: string,
  ) {
    const { file, stream } = await this.files.download(owner(me), taskId, validFileId(fileId));
    const escaped = encodeURIComponent(file.name).replace(/['()*]/g, (character) => '%' + character.charCodeAt(0).toString(16));
    return new StreamableFile(stream, { length: file.size, disposition: "attachment; filename*=UTF-8''" + escaped });
  }

  @Delete(':fileId')
  @Header('Cache-Control', 'private, no-store')
  @ApiOkResponse({ type: DeskFileDto })
  @ApiOperation({ summary: 'Убрать файл своей задачи в корзину задачи' })
  remove(
    @CurrentUser() me: AuthenticatedUser,
    @Param('taskId', new ParseUUIDPipe({ version: '4' })) taskId: string,
    @Param('fileId') fileId: string,
  ) {
    return this.files.setDeleted(owner(me), taskId, validFileId(fileId), true);
  }

  @Post(':fileId/restore')
  @Header('Cache-Control', 'private, no-store')
  @ApiCreatedResponse({ type: DeskFileDto })
  @ApiOperation({ summary: 'Вернуть файл из корзины своей задачи' })
  restore(
    @CurrentUser() me: AuthenticatedUser,
    @Param('taskId', new ParseUUIDPipe({ version: '4' })) taskId: string,
    @Param('fileId') fileId: string,
  ) {
    return this.files.setDeleted(owner(me), taskId, validFileId(fileId), false);
  }
}
