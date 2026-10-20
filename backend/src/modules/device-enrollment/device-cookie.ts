import type { Request, Response } from 'express';

/**
 * TZ-AUTH-303 — `__Host-` device cookie helpers.
 *
 * The browser grant secret is the ONLY thing a device presents. It lives in a
 * `__Host-` cookie which, per the cookie spec, can only be set when the
 * cookie is `Secure`, has `Path=/`, and has NO `Domain` attribute — so the
 * browser itself refuses to store it on a non-HTTPS origin. We set it with
 * `Secure + HttpOnly + SameSite=Lax`, no `Domain`, `Path=/`, and `maxAge`
 * equal to the grant lifetime (default 365d).
 *
 * Parsing is done manually (no cookie-parser dependency): we read the raw
 * `Cookie` header and look up the exact name. The name MUST start with
 * `__Host-`; the config schema already enforces this.
 */

export interface DeviceCookieOptions {
  name: string;
  maxAgeMs: number;
}

/** Read a cookie value by exact name from the raw Cookie header. */
export function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers?.cookie;
  if (!header) return undefined;
  const entries = String(header).split(';');
  for (const entry of entries) {
    const eq = entry.indexOf('=');
    if (eq === -1) continue;
    const key = entry.slice(0, eq).trim();
    if (key === name) {
      const value = entry.slice(eq + 1).trim();
      return value.length > 0 ? value : undefined;
    }
  }
  return undefined;
}

/** Set the `__Host-` device cookie on a response. */
export function setDeviceCookie(
  res: Response,
  name: string,
  secret: string,
  maxAgeMs: number,
): void {
  res.cookie(name, secret, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: maxAgeMs,
  });
}

/** Clear the device cookie (logout of a device / revoke). */
export function clearDeviceCookie(res: Response, name: string): void {
  res.clearCookie(name, { httpOnly: true, secure: true, sameSite: 'lax', path: '/' });
}
