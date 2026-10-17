import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, mergeMap } from 'rxjs';
import { AuditService } from '../../modules/audit/audit.service';

export const AUDIT_ACTION_KEY = 'auditAction';

export interface AuditActionMetadata {
  action: string;
  entityType: string;
  /**
   * Path of the param holding the entity id, e.g. 'id'.
   * Used to set entityId in the log.
   */
  idParam?: string;
  /**
   * Explicit opt-in for read operations. GET requests remain unaudited by
   * default; sensitive read surfaces may opt in without auditing every GET.
   */
  auditRead?: boolean;
}

export const AuditAction = (meta: AuditActionMetadata): MethodDecorator =>
  SetMetadata(AUDIT_ACTION_KEY, meta);

interface RequestWithUser {
  method: string;
  url: string;
  params: Record<string, string>;
  user?: { id: string; username: string };
  ip?: string;
}

/**
 * Global interceptor: after a successful POST/PATCH/PUT/DELETE that has
 * @AuditAction() metadata, writes an AuditLog entry. GET handlers may opt in
 * explicitly with `auditRead: true` on the decorator; ordinary GETs remain
 * unaudited.
 *
 * Auth writes are handled directly by AuthService.log() (TZ-04), not here.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger('AuditInterceptor');

  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AuditService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const meta = this.reflector.get<AuditActionMetadata | undefined>(
      AUDIT_ACTION_KEY,
      context.getHandler(),
    );
    if (!meta) return next.handle();

    const req = context.switchToHttp().getRequest<RequestWithUser>();
    const isWrite = ['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method);
    const isAuditedRead = req.method === 'GET' && meta.auditRead === true;
    if (!isWrite && !isAuditedRead) {
      return next.handle();
    }

    const entityId = meta.idParam ? req.params?.[meta.idParam] : undefined;

    return next.handle().pipe(
      mergeMap(async (data: unknown) => {
        const idFromResponse =
          (data as { _id?: string; id?: string } | undefined)?._id ??
          (data as { _id?: string; id?: string } | undefined)?.id;
        const reqUser = (req as RequestWithUser).user;
        try {
          await this.audit.log({
            action: meta.action,
            entityType: meta.entityType,
            entityId: entityId ?? idFromResponse,
            details: { after: this.safeSnapshot(data) },
            ipAddress: req.ip,
            userId: reqUser?.id,
            userName: reqUser?.username,
          });
        } catch (e) {
          this.logger.error('Audit log failed', (e as Error).stack);
        }
        return data;
      }),
    );
  }

  private safeSnapshot(data: unknown): Record<string, unknown> | undefined {
    if (!data || typeof data !== 'object') return undefined;
    const obj = data as Record<string, unknown>;
    // Drop sensitive fields
    const { passwordHash: _ph, password: _p, refreshToken: _rt, ...rest } =
      obj as Record<string, unknown> & {
        passwordHash?: unknown;
        password?: unknown;
        refreshToken?: unknown;
      };
    void _ph; void _p; void _rt;
    return rest;
  }
}
