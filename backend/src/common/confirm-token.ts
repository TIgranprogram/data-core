import { createHmac, timingSafeEqual } from 'crypto';

/** Срок жизни токена подтверждения паролем, секунд. */
export const CONFIRM_TTL_SEC = 120;

function secret(): string {
  // отдельный ключ: токен подтверждения нельзя предъявить как access-токен
  return `${process.env.JWT_SECRET ?? ''}:confirm`;
}

function sig(body: string): string {
  return createHmac('sha256', secret()).update(body).digest('base64url');
}

/** Токен «пароль только что подтверждён» для пользователя userId. Не JWT, живёт CONFIRM_TTL_SEC. */
export function signConfirmToken(userId: string, now = Date.now()): string {
  const body = Buffer.from(JSON.stringify({ u: userId, e: now + CONFIRM_TTL_SEC * 1000 })).toString('base64url');
  return `${body}.${sig(body)}`;
}

/** true — токен подлинный, не истёк и выдан именно этому пользователю. */
export function verifyConfirmToken(token: unknown, userId: string, now = Date.now()): boolean {
  if (typeof token !== 'string') return false;
  const [body, s, extra] = token.split('.');
  if (!body || !s || extra !== undefined) return false;
  const want = Buffer.from(sig(body)), got = Buffer.from(s);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return false;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as { u?: string; e?: number };
    return p.u === userId && typeof p.e === 'number' && p.e > now;
  } catch {
    return false;
  }
}
