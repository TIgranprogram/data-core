import {
  CanActivate,
  Controller,
  ExecutionContext,
  ForbiddenException,
  Get,
  Header,
  HttpCode,
  Injectable,
  Logger,
  NestInterceptor,
  Param,
  Post,
  Query,
  UnauthorizedException,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  type CallHandler,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiBody, ApiOkResponse, ApiProperty } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Matches } from 'class-validator';
import { promises as fs } from 'fs';
import { finalize } from 'rxjs';
import { AppSection } from '../../common/decorators/app-section.decorator';
import { CurrentUser, getAuthenticatedUser, type AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { canSeeMoney } from '../../common/roles-hierarchy';
import { AuditAction } from '../../common/interceptors/audit.interceptor';
import { PhotoIntakeService, type PhotoIntakeReceipt } from './photo-intake.service';
import { fileErrorCode, intakeUploadOptions, type IntakeUploadFile } from './photo-intake.storage';

class IntakeUidParam {
  @ApiProperty({ pattern: '^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$' })
  @Matches(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/, { message: 'Некорректный ключ оригинала' })
  uid!: string;
}

class IntakeHashQuery {
  @ApiProperty({ pattern: '^[a-f0-9]{64}$' })
  @Matches(/^[a-f0-9]{64}$/, { message: 'Укажите SHA-256 оригинала в нижнем регистре' })
  sha256!: string;
}

class IntakeReceiptDto implements PhotoIntakeReceipt {
  @ApiProperty() uid!: string;
  @ApiProperty() sha256!: string;
  @ApiProperty() fileId!: string;
  @ApiProperty() storageUrl!: string;
}

@Injectable()
export class PhotoIntakeAccessGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const user = getAuthenticatedUser(context);
    if (!user?.id) throw new UnauthorizedException('Войдите для загрузки оригиналов');
    if (!canSeeMoney(user)) throw new ForbiddenException('Для загрузки оригиналов нужен доступ к денежным данным');
    return true;
  }
}

/** Очищает файл multer и при ошибке DTO, записи или сверки. */
@Injectable()
export class IntakeStagingCleanup implements NestInterceptor {
  private readonly logger = new Logger(IntakeStagingCleanup.name);

  intercept(context: ExecutionContext, next: CallHandler) {
    const req = context.switchToHttp().getRequest<{ file?: IntakeUploadFile }>();
    return next.handle().pipe(finalize(() => {
      if (!req.file) return;
      void fs.unlink(req.file.path).catch(error => {
        if (fileErrorCode(error) !== 'ENOENT') this.logger.warn('Не удалось удалить временный файл загрузки оригинала');
      });
    }));
  }
}

@Controller('photos/intake')
@AppSection('salesorders', 'offers', 'requests')
@UseGuards(PhotoIntakeAccessGuard)
export class PhotoIntakeController {
  constructor(private readonly intake: PhotoIntakeService) {}

  @Post(':uid')
  @Roles('admin', 'manager')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @Throttle({ short: { ttl: 60_000, limit: 60 } })
  @UseInterceptors(IntakeStagingCleanup, FileInterceptor('file', intakeUploadOptions))
  @AuditAction({ action: 'photo.intake.upload', entityType: 'Photo' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', required: ['file'], properties: { file: { type: 'string', format: 'binary' } } } })
  @ApiOkResponse({ type: IntakeReceiptDto })
  upload(
    @Param() { uid }: IntakeUidParam,
    @Query() { sha256 }: IntakeHashQuery,
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file?: IntakeUploadFile,
  ) {
    return this.intake.upload(uid, sha256, user.id, file);
  }

  @Get(':uid')
  @Roles('admin', 'manager')
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({ type: IntakeReceiptDto })
  receipt(@Param() { uid }: IntakeUidParam, @CurrentUser() user: AuthenticatedUser) {
    return this.intake.receipt(uid, user.id);
  }
}
