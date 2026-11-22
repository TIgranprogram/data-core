import {
  CallHandler,
  ConflictException,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
  StreamableFile,
} from '@nestjs/common';
import { createHash } from 'crypto';
import type { Request, Response } from 'express';
import { mergeMap, of } from 'rxjs';
import { openSectionsFor } from '../app-sections';
import type { AuthenticatedUser } from '../decorators/current-user.decorator';
import { canSeeMoney, effectiveRoles } from '../roles-hierarchy';
import { scopeMatch, stockScopeFor } from '../stock-scope';
import { IdempotencyStorageService } from './idempotency-storage.service';

type AuthenticatedRequest = Request & { user?: AuthenticatedUser };

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const EXCLUDED_PATHS = [
  '/auth',
  '/health',
  '/desktop/pairing',
  '/desktop/pairing-keys',
  '/admin/devices',
  '/photos/intake',
  '/supply/invoices/intake',
];
const BODY_SIZE_LIMIT = 256 * 1024;

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function credentialScope(req: AuthenticatedRequest, actor: AuthenticatedUser): string | undefined {
  if (!actor.keyScope) return 'jwt';
  const accessToken = req.get('X-Access-Token') ?? '';
  const authorization = req.get('Authorization') ?? '';
  const bearer = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
  const key = accessToken.startsWith('kppd_') ? accessToken : bearer;
  if (key.startsWith('kppd_')) return sha256(key);
}

function excluded(path: string): boolean {
  const route = path.toLowerCase().replace(/^(?:\/db)?\/api(?=\/|$)/, '');
  return EXCLUDED_PATHS.some((prefix) => route === prefix || route.startsWith(prefix + '/'));
}

function computeFingerprint(req: AuthenticatedRequest, actor: AuthenticatedUser): string | undefined {
  try {
    const body = JSON.stringify(req.body ?? null);
    if (Buffer.byteLength(body) > BODY_SIZE_LIMIT) return;
    const sections = openSectionsFor(actor);
    const access = {
      role: actor.role,
      roles: effectiveRoles(actor.role).sort(),
      permissions: [...(actor.permissions ?? [])].sort(),
      rolePermissions: [...(actor.rolePermissions ?? [])].sort(),
      organization: actor.organizationId ?? null,
      owner: Boolean(actor.isOwner),
      money: canSeeMoney(actor),
      sections: sections && [...sections].sort(),
      stock: scopeMatch(stockScopeFor(actor)),
      keyScope: actor.keyScope ?? null,
    };
    return sha256(JSON.stringify([req.method, req.originalUrl, body, access]));
  } catch {
    // Несериализуемый запрос не кешируется.
  }
}

function cacheableJson(body: unknown): Record<string, unknown> | undefined {
  if (!body || typeof body !== 'object' || body instanceof StreamableFile || Buffer.isBuffer(body)) return;
  try {
    const json = JSON.stringify(body, (name, value) =>
      /token|password|secret|^authorization$|^api[_-]?key$/i.test(name) ? '[REDACTED]' : value,
    );
    if (Buffer.byteLength(json) <= BODY_SIZE_LIMIT) return JSON.parse(json);
  } catch {
    // Несериализуемый ответ не кешируется.
  }
}

/** Кеш успешного ответа доступен только после проверки текущих прав запроса. */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly logger = new Logger(IdempotencyInterceptor.name);

  constructor(private readonly storage: IdempotencyStorageService) {}

  async intercept(context: ExecutionContext, next: CallHandler) {
    const http = context.switchToHttp();
    const req = http.getRequest<AuthenticatedRequest>();
    const actor = req.user;
    const key = req.get('Idempotency-Key');
    if (
      !actor?.id || !key || !MUTATING_METHODS.has(req.method) ||
      excluded(req.path) || req.is('multipart/*')
    ) return next.handle();

    const credential = credentialScope(req, actor);
    const fingerprint = computeFingerprint(req, actor);
    if (!credential || !fingerprint) return next.handle();

    // Новый префикс исключает повтор из старых записей с общим ключом.
    const storageKey = 'v2:' + sha256(JSON.stringify([actor.id, credential, key]));
    const res = http.getResponse<Response>();
    const existing = await this.storage.findByKey(storageKey);
    if (existing) {
      if (existing.requestFingerprint !== fingerprint) {
        throw new ConflictException({
          code: 'IDEMPOTENCY_KEY_REUSED',
          message: 'Idempotency-Key reused with a different payload',
        });
      }
      res.status(existing.httpStatus);
      return of(existing.cachedResponse);
    }

    return next.handle().pipe(mergeMap(async (body: unknown) => {
      if (res.statusCode < 200 || res.statusCode >= 300 || res.headersSent) return body;
      const cachedResponse = cacheableJson(body);
      if (!cachedResponse) return body;
      try {
        await this.storage.insertOrFetch({
          idempotencyKey: storageKey,
          requestFingerprint: fingerprint,
          storedAt: new Date(),
          httpStatus: res.statusCode,
          cachedResponse,
        });
      } catch {
        this.logger.warn('Не удалось сохранить ответ для повтора запроса');
      }
      return body;
    }));
  }
}
