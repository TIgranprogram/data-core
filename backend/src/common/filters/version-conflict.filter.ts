import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class VersionConflictFilter implements ExceptionFilter {
  private readonly logger = new Logger(VersionConflictFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    if (
      !(exception instanceof Error) ||
      exception.name !== 'VersionError'
    ) {
      return;
    }

    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    this.logger.warn(
      `${request.method} ${request.url} → 409 (version conflict: ${exception.message})`,
    );

    response.status(HttpStatus.CONFLICT).json({
      statusCode: HttpStatus.CONFLICT,
      timestamp: new Date().toISOString(),
      path: request.url,
      method: request.method,
      message: 'Документ был изменён другим пользователем. Обновите страницу и повторите попытку.',
      error: 'Version Conflict',
    });
  }
}
