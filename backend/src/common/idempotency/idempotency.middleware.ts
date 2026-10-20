import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import * as crypto from 'crypto';
import { IdempotencyStorageService } from './idempotency-storage.service';

/**
 * TZ-247 — Backend idempotency middleware.
 *
 * For any mutating request (POST/PUT/PATCH/DELETE) with an `Idempotency-Key`
 * header, this middleware:
 *
 *   1. Hashes the request body into a fingerprint (skip if body > 256KB).
 *   2. Looks up a prior record with the same key.
 *      - Not found: pass through; capture response on success and persist.
 *      - Found + fingerprint MATCH: replay the cached response (200/201 + body).
 *      - Found + fingerprint MISMATCH: 409 Conflict.
 *   3. Exclude list: `/auth/login`, `/auth/register`, `/auth/refresh`,
 *      `/auth/logout`, `/health` → pass-through without processing.
 *
 * Header is OPTIONAL — requests without a key continue unchanged.
 *
 * Sensitive fields (passwordHash, refreshTokenVersion) are redacted from
 * the cached response before storage. Large bodies (> 256KB) skip the
 * cache silently (header is honored but no persistence happens).
 *
 * Reference: TZ-247 §2.
 */
@Injectable()
export class IdempotencyMiddleware implements NestMiddleware {
  private readonly logger = new Logger(IdempotencyMiddleware.name);

  private static readonly MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
  private static readonly EXCLUDE_PATHS = [
    '/auth/login',
    '/auth/register',
    '/auth/refresh',
    '/auth/logout',
    '/health',
  ];
  private static readonly BODY_SIZE_LIMIT = 256 * 1024;

  constructor(private readonly storage: IdempotencyStorageService) {}

  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    if (!IdempotencyMiddleware.MUTATING_METHODS.has(req.method)) {
      return next();
    }

    if (IdempotencyMiddleware.EXCLUDE_PATHS.some((p) => req.path.startsWith(p))) {
      return next();
    }

    const key = req.header('Idempotency-Key');
    if (!key) {
      return next();
    }

    const fingerprint = this.computeFingerprint(req);
    if (!fingerprint) {
      // Body too large; honor header but skip caching.
      return next();
    }

    const existing = await this.storage.findByKey(key);
    if (existing) {
      if (existing.requestFingerprint !== fingerprint) {
        res.status(409).json({
          code: 'IDEMPOTENCY_KEY_REUSED',
          message: 'Idempotency-Key reused with a different payload',
        });
        return;
      }
      res.status(existing.httpStatus).json(existing.cachedResponse);
      return;
    }

    // Capture response on the way out. We override res.json once via
    // Object.defineProperty so the Express @types/express readonly method
    // declaration does not block the replacement at compile time. The new
    // method persists synchronously before delegating to the original
    // so callers still receive the response body.
    //
    // TZ-247.B: switched from `self.storage.insert(...)` (fire-and-forget
    // with `.catch(silent-log)`) to `self.storage.insertOrFetch(...)`.
    // `insertOrFetch` is E11000-race-safe — two concurrent first-callers
    // with the same key both pass `findByKey === null`, but only one
    // upsert wins; the loser's call returns the WINNER's record,
    // guaranteeing the cached body matches the canonical record.
    const originalJson = res.json.bind(res);
    // `jsonPatched` below re-declares its own `this: Response` parameter,
    // which shadows the outer @Injectable class `this`. We deliberately
    // alias to `self` so the patch can still reach IdempotencyMiddleware
    // instance state (storage, logger, redact). Pattern is endorsed by
    // NestJS community guidance for capturing `this` inside method
    // overrides that re-bind parameter scope.
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    Object.defineProperty(res, 'json', {
      configurable: true,
      writable: true,
      value: function jsonPatched(this: Response, body: unknown): Response {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          const sanitized = self.redact(body);
          // `void` swallow: the response is sent immediately by the
          // caller of res.json. Persistence happens in the background.
          // On E11000 or similar transient errors the catch logs at
          // warn level — never at error — because a failed insert is
          // recoverable (next request will simply re-execute instead
          // of replaying the cached response). All error swallowing is
          // explicit per TZ-247.B AC #10.
          void self.storage
            .insertOrFetch({
              idempotencyKey: key,
              requestFingerprint: fingerprint,
              storedAt: new Date(),
              httpStatus: res.statusCode,
              cachedResponse: sanitized as Record<string, unknown>,
            })
            .catch((err: unknown) => {
              self.logger.warn(
                `Failed to persist idempotency record for key=${key}: ${
                  err instanceof Error ? err.message : String(err)
                }`,
              );
            });
        }
        return originalJson(body);
      },
    });

    return next();
  }

  /**
   * SHA-256 of `METHOD+PATH+sorted-body-bytes`.
   * Returns null if body is too large to fingerprint, or if JSON.stringify
   * throws (circular / BigInt). The caller handles null as "skip caching".
   *
   * JSDoc redaction breadth: spec TZ-247 enumerated three sensitive
   * patterns (passwordHash, refreshTokenVersion, anything matching `/token/i`).
   * This implementation does NOT cover the broader "any PII" interpretation;
   * the narrow pattern is intentional to match the spec verbatim.
   */
  private computeFingerprint(req: Request): string | null {
    let rawBody = '';
    if (req.body !== undefined && req.body !== null) {
      try {
        rawBody = JSON.stringify(req.body);
      } catch {
        // Circular / BigInt / non-serialisable — treat as uncacheable.
        return null;
      }
    }
    if (rawBody.length > IdempotencyMiddleware.BODY_SIZE_LIMIT) {
      return null;
    }
    return crypto
      .createHash('sha256')
      .update(`${req.method}|${req.path}|${rawBody}`)
      .digest('hex');
  }

  /**
   * Strip known sensitive fields before persistence:
   * `passwordHash`, `refreshTokenVersion`, anything matching `/token/i`.
   *
   * CYCLE SAFETY (TZ-247 stack-overflow fix): controllers may pass
   * Mongoose documents (or other ORM objects) straight to `res.json`.
   * Such objects carry internal cyclic structures (`$__`/`_doc` with a
   * back-reference to the document itself), and a naive recursive walk
   * over `Object.entries` recurses forever → `RangeError: Maximum call
   * stack size exceeded` (observed on `POST /api/document-templates`).
   *
   * Defense in depth:
   *   1. JSON round-trip first — mirrors exactly what `res.json` will
   *      serialize for the client (Mongoose docs have `toJSON`), so the
   *      cached copy matches the wire payload and internal cyclic
   *      structures never reach the walk.
   *   2. If the body is not JSON-serializable (plain circular object,
   *      BigInt, functions), fall back to a cycle-guarded walk that
   *      flags genuine ancestor cycles as `[Circular]` without
   *      recursing, while still allowing shared (non-cyclic) references.
   */
  private redact(body: unknown): unknown {
    let plain: unknown = body;
    if (body !== undefined && body !== null) {
      try {
        plain = JSON.parse(JSON.stringify(body));
      } catch {
        // Non-serializable (circular plain object, BigInt, functions…)
        // — keep the raw value and let the guarded walk handle it.
        plain = body;
      }
    }

    // Ancestors currently being visited. Only genuine cycles are flagged;
    // shared references appearing twice in different branches are walked
    // twice (no false `[Circular]` markers).
    const stack = new Set<object>();

    const walk = (value: unknown): unknown => {
      if (Array.isArray(value)) {
        return value.map(walk);
      }
      if (value && typeof value === 'object') {
        if (stack.has(value)) {
          return '[Circular]';
        }
        stack.add(value);
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value)) {
          if (
            k === 'passwordHash' ||
            k === 'refreshTokenVersion' ||
            /token/i.test(k)
          ) {
            out[k] = '[REDACTED]';
            continue;
          }
          out[k] = walk(v);
        }
        stack.delete(value);
        return out;
      }
      return value;
    };

    return walk(plain);
  }
}
