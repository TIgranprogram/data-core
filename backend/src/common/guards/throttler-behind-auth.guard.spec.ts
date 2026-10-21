import { ThrottlerStorage } from '@nestjs/throttler';
import { Reflector } from '@nestjs/core';
import { ThrottlerBehindAuthGuard } from './throttler-behind-auth.guard';

interface FakeReqShape {
  ip?: string;
  socket?: { remoteAddress?: string };
  connection?: { remoteAddress?: string };
  user?: { sub?: string; role?: string };
  headers?: Record<string, string | string[]>;
}

function makeReq(parts: FakeReqShape): Record<string, unknown> {
  return parts as unknown as Record<string, unknown>;
}

/**
 * Build a ThrottlerBehindAuthGuard instance with stub ThrottlerGuard
 * superclass deps so we never depend on DI / module-level wiring in
 * unit tests. The stub options / storage / reflector are never *used* by
 * getTracker / shouldSkip, only by the parent class lifecycle methods.
 */
function makeGuard(): ThrottlerBehindAuthGuard {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new ThrottlerBehindAuthGuard(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    {} as any,
    {} as unknown as ThrottlerStorage,
    {} as Reflector,
  );
}

/**
 * TZ-249 §2.1 — Throttler guard tests:
 *   - X-Forwarded-For only trusted if TRUST_PROXY=1 explicitly.
 *   - DISABLE_THROTTLE has no effect in production (TZ-249 §2.1 step 1).
 *   - Tier limit helper has sane fallback for unknown roles.
 *
 * `getTracker` and `shouldSkip` are `protected` on the parent class, so
 * we cast the instance to `any` to bypass the TS access check. The
 * methods are still real methods — we are not mocking behaviour.
 */
describe('ThrottlerBehindAuthGuard (TZ-249 §2.1)', () => {
  const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
  const ORIGINAL_DISABLE_THROTTLE = process.env.DISABLE_THROTTLE;
  const ORIGINAL_TRUST_PROXY = process.env.TRUST_PROXY;

  afterEach(() => {
    process.env.NODE_ENV = ORIGINAL_NODE_ENV;
    process.env.DISABLE_THROTTLE = ORIGINAL_DISABLE_THROTTLE;
    process.env.TRUST_PROXY = ORIGINAL_TRUST_PROXY;
  });

  describe('getTracker() — IP source-of-truth', () => {
    it('honors X-Forwarded-For when TRUST_PROXY=1', async () => {
      process.env.TRUST_PROXY = '1';
      const guard = makeGuard();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tracker = await (guard as any).getTracker(
        makeReq({
          ip: '127.0.0.1',
          socket: { remoteAddress: '10.0.0.1' },
          headers: { 'x-forwarded-for': '203.0.113.42' },
        }),
      );
      expect(tracker).toBe('tier:anon:ip:203.0.113.42');
    });

    it('ignores X-Forwarded-For when TRUST_PROXY is unset', async () => {
      delete process.env.TRUST_PROXY;
      const guard = makeGuard();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tracker = await (guard as any).getTracker(
        makeReq({
          ip: '127.0.0.1',
          socket: { remoteAddress: '10.0.0.1' },
          headers: { 'x-forwarded-for': '203.0.113.42' },
        }),
      );
      expect(tracker).toBe('tier:anon:ip:10.0.0.1');
    });

    it('falls back to req.ip when neither socket nor XFF are present', async () => {
      delete process.env.TRUST_PROXY;
      const guard = makeGuard();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tracker = await (guard as any).getTracker(
        makeReq({
          ip: '198.51.100.7',
        }),
      );
      expect(tracker).toBe('tier:anon:ip:198.51.100.7');
    });

    it('uses the user role from JWT payload when present', async () => {
      delete process.env.TRUST_PROXY;
      const guard = makeGuard();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tracker = await (guard as any).getTracker(
        makeReq({
          socket: { remoteAddress: '10.0.0.1' },
          user: { sub: 'u1', role: 'admin' },
        }),
      );
      expect(tracker).toBe('tier:admin:ip:10.0.0.1');
    });
  });

  describe('shouldSkip() — DISABLE_THROTTLE enforcement', () => {
    it('does NOT skip in production even with DISABLE_THROTTLE=1', async () => {
      process.env.NODE_ENV = 'production';
      process.env.DISABLE_THROTTLE = '1';
      const guard = makeGuard();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(await (guard as any).shouldSkip({} as never)).toBe(false);
    });

    it('skips in development when DISABLE_THROTTLE=1', async () => {
      process.env.NODE_ENV = 'development';
      process.env.DISABLE_THROTTLE = '1';
      const guard = makeGuard();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(await (guard as any).shouldSkip({} as never)).toBe(true);
    });

    it('does NOT skip in development without DISABLE_THROTTLE', async () => {
      process.env.NODE_ENV = 'development';
      delete process.env.DISABLE_THROTTLE;
      const guard = makeGuard();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(await (guard as any).shouldSkip({} as never)).toBe(false);
    });

    it('treats truthy-coerce values (DISABLE_THROTTLE=true) as in-effect in dev', async () => {
      process.env.NODE_ENV = 'development';
      process.env.DISABLE_THROTTLE = 'true';
      const guard = makeGuard();
      // Strict equality — 'true' is NOT === '1' so opt-out is rejected.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(await (guard as any).shouldSkip({} as never)).toBe(false);
    });
  });

  describe('getLimitForRole()', () => {
    it('returns anon-tier limit for unknown roles (defensive fallback)', () => {
      const guard = makeGuard();
      expect(guard.getLimitForRole('unknown-role')).toEqual({
        ttl: 60_000,
        limit: 10,
      });
    });

    it('returns admin-tier limit for role=admin', () => {
      const guard = makeGuard();
      expect(guard.getLimitForRole('admin')).toEqual({
        ttl: 60_000,
        limit: 100,
      });
    });
  });
});
