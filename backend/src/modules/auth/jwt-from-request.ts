import { ExtractJwt, JwtFromRequestFunction } from 'passport-jwt';
import type { Request } from 'express';

/** Shared with frontend `jwt-access-header.ts` — keep names in sync. */
export const JWT_ACCESS_HEADER = 'x-access-token';

/**
 * Prefer `X-Access-Token` (Basic Auth–safe), fall back to Bearer.
 */
export const jwtFromRequest: JwtFromRequestFunction = ExtractJwt.fromExtractors([
  (req: Request) => {
    const raw = req?.headers?.[JWT_ACCESS_HEADER];
    if (typeof raw === 'string' && raw.trim()) return raw.trim();
    if (Array.isArray(raw) && raw[0]) return String(raw[0]).trim();
    return null;
  },
  ExtractJwt.fromAuthHeaderAsBearerToken(),
]);
