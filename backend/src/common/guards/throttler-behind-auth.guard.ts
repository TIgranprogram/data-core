import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

interface ThrottlerRequest {
  user?: { sub?: string; role?: string };
  headers?: Record<string, string | string[]>;
  ip?: string;
  socket?: { remoteAddress?: string };
  connection?: { remoteAddress?: string };
}

interface TierLimit {
  ttl: number;
  limit: number;
}

const TIER_LIMITS: Record<string, TierLimit> = {
  anon: { ttl: 60_000, limit: 10 },
  auth: { ttl: 60_000, limit: 30 },
  admin: { ttl: 60_000, limit: 100 },
};

@Injectable()
export class ThrottlerBehindAuthGuard extends ThrottlerGuard {
  /**
   * TZ-249 §2.1 — X-Forwarded-For is only trusted if `TRUST_PROXY=1` is
   * explicitly set in the environment. In every other case the IP is
   * computed from `req.socket.remoteAddress` / `req.connection.remoteAddress`
   * so that spoofable headers cannot reach the throttle tracker.
   *
   * Layering note: TZ-249 also sets `app.set('trust proxy', …)` in
   * `main.ts`, but we mirror it here defensively in case any middleware
   * (e.g. NestJS request-context internals) reads `req.ip` *between*
   * the trust-proxy flip and the throttle call.
   */
  protected async getTracker(req: Record<string, unknown>): Promise<string> {
    const r = req as ThrottlerRequest;
    const headers = r.headers ?? {};
    const trustProxy = process.env.TRUST_PROXY === '1';

    let ip: string;
    if (trustProxy) {
      const xff = headers['x-forwarded-for'];
      ip = (Array.isArray(xff) ? xff[0] : xff) ?? r.ip ?? 'unknown';
    } else {
      ip =
        r.socket?.remoteAddress ??
        r.connection?.remoteAddress ??
        r.ip ??
        'unknown';
    }

    const role = r.user?.role ?? 'anon';
    return `tier:${role}:ip:${ip}`;
  }

  /**
   * TZ-249 §2.1 — `DISABLE_THROTTLE=1` has no effect in production. The
   * guard refuses to skip there even if the env variable is set, mirroring
   * the bootstrap-time guard in `main.ts` (belt-and-suspenders).
   *
   * Strict string match: `'true'`, `'yes'`, `'0'` etc. do NOT opt-out.
   */
  protected async shouldSkip(): Promise<boolean> {
    if (process.env.NODE_ENV === 'production') return false;
    if (process.env.DISABLE_THROTTLE === '1') return true;
    return false;
  }

  getLimitForRole(role: string): TierLimit {
    return TIER_LIMITS[role] ?? TIER_LIMITS.anon;
  }
}
