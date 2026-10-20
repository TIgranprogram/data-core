import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { MulterError } from 'multer';

/**
 * TZ-86 Phase A.6 — Multer-specific exception filter.
 *
 * Maps Multer-thrown errors (size, field-name, count) to proper HTTP
 * status codes. Reuses the same response envelope shape as
 * `HttpExceptionFilter` so log-shipping/observability stays unified.
 *
 * Why a dedicated filter:
 * - `MulterError('LIMIT_FILE_SIZE', 'file')` does NOT extend HttpException
 *   → global `HttpExceptionFilter` would map it to 500 (Internal Server Error).
 *   For an oversize upload we want 413 (Payload Too Large).
 * - `MulterError('LIMIT_UNEXPECTED_FILE', 'file')` → 400 (wrong field name).
 * - `MulterError('LIMIT_FILE_COUNT', files)` → 400 (too many files).
 * - `MulterError('LIMIT_PART_COUNT')` → 400 (multipart parsing failure).
 *
 * Scope: registered as APP_FILTER in app.module.ts so any `FileInterceptor`
 * route (current: DocumentTemplate upload-background; future: any module
 * that adds file upload) gets the mapping for free. FileFilter rejections
 * already throw `BadRequestException` from inside the fileFilter and are
 * caught by `HttpExceptionFilter` — no overlap.
 */
@Catch(MulterError)
export class MulterExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(MulterExceptionFilter.name);

  catch(exception: MulterError, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const mapping: Partial<Record<MulterError['code'], HttpStatus>> = {
      LIMIT_FILE_SIZE: HttpStatus.PAYLOAD_TOO_LARGE, // 413
      LIMIT_FILE_COUNT: HttpStatus.BAD_REQUEST, // 400
      LIMIT_UNEXPECTED_FILE: HttpStatus.BAD_REQUEST, // 400
      LIMIT_PART_COUNT: HttpStatus.BAD_REQUEST, // 400
      LIMIT_FIELD_COUNT: HttpStatus.BAD_REQUEST, // 400
      LIMIT_FIELD_KEY: HttpStatus.BAD_REQUEST, // 400
      LIMIT_FIELD_VALUE: HttpStatus.BAD_REQUEST, // 400
    };
    const status = mapping[exception.code] ?? HttpStatus.BAD_REQUEST;

    const humanMessage: Partial<Record<MulterError['code'], string>> = {
      LIMIT_FILE_SIZE:
        'Файл превышает максимально допустимый размер (5 МБ).',
      LIMIT_FILE_COUNT: 'Слишком много файлов в запросе (допустимо: 1).',
      LIMIT_UNEXPECTED_FILE:
        'Неожиданное имя поля файла. Ожидается поле «file».',
      LIMIT_PART_COUNT: 'Слишком много multipart-частей в запросе.',
      LIMIT_FIELD_COUNT: 'Слишком много полей в форме.',
      LIMIT_FIELD_KEY: 'Слишком длинное имя поля.',
      LIMIT_FIELD_VALUE: 'Слишком длинное значение поля.',
    };
    const message = humanMessage[exception.code] ?? exception.message;

    this.logger.warn(
      `${request.method} ${request.url} → ${status} (${exception.code}: ${exception.message})`,
    );

    response.status(status).json({
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      method: request.method,
      message,
      multerError: exception.code,
      field: exception.field,
    });
  }
}
