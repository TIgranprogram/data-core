import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, catchError, finalize, tap, throwError } from 'rxjs';
import { Request, Response } from 'express';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();
    const start = Date.now();

    return next.handle().pipe(
      tap(() => {
        const ms = Date.now() - start;
        this.logger.log({
          msg: 'request',
          method: req.method,
          url: req.originalUrl,
          status: res.statusCode,
          durationMs: ms,
          requestId: req.requestId,
        });
      }),
      catchError((err) => {
        const ms = Date.now() - start;
        const status = (err as { status?: number })?.status ?? 500;
        this.logger.warn({
          msg: 'request error',
          method: req.method,
          url: req.originalUrl,
          status,
          durationMs: ms,
          requestId: req.requestId,
        });
        return throwError(() => err);
      }),
      finalize(() => {
        const ms = Date.now() - start;
        if (ms > 1000) {
          this.logger.warn({
            msg: 'slow request',
            method: req.method,
            url: req.originalUrl,
            durationMs: ms,
            requestId: req.requestId,
          });
        }
      }),
    );
  }
}
