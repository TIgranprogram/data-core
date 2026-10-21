import { Injectable, Logger } from '@nestjs/common';

/**
 * TZ-249 §2.4 — Per-username softlock service.
 *
 * After 5 failed login attempts within a 15-minute window, the username is
 * soft-locked for 15 minutes. State is held in an in-memory Map; this is
 * single-instance only. Multi-pod deployment is a documented follow-up
 * (Redis-backed `LoginSoftlockStore` interface swap; no breaking change to
 * the public API).
 *
 * Why in-Map and not Redis:
 * - The corporate CRM runs a single NestJS instance per tenant deployment.
 * - 5 failed attempts / 15 minutes is scoped per username, not global.
 * - Cross-instance consistency for this control is acceptable to defer to
 *   TZ-249 §4 step 4 follow-ups; the production bootstrap already has the
 *   SECRET guard (TZ-248) but the softlock layer runs in user space.
 *
 * Username normalization:
 * - `username.trim().toLowerCase()` — defensive against attackers
 *   rotating trailing whitespace or case to bypass the bucketing.
 *
 * Reset semantics:
 * - Successful `login` calls `reset()` — clears the bucket.
 * - Failure increments the count; if the count crosses the threshold, the
 *   bucket is locked for SOFTLOCK_DURATION_MS.
 * - Buckets older than the failure window reset the count (so a slow attacker
 *   who spreads 4 failures over an hour and a half never triggers the lock).
 */
const SOFTLOCK_MAX_FAILS = 5;
const SOFTLOCK_DURATION_MS = 15 * 60 * 1000;
const SOFTLOCK_FAILS_WINDOW_MS = 15 * 60 * 1000;

interface SoftlockEntry {
  /** Number of failed login attempts recorded in the current window. */
  count: number;
  /** Epoch ms when the softlock expires. 0 = not currently locked. */
  lockedUntil: number;
  /** Epoch ms of the first failure in the current window. */
  firstFailureAt: number;
}

function normalizeUsername(username: string): string {
  return (username ?? '').trim().toLowerCase();
}

@Injectable()
export class LoginSoftlockService {
  private readonly logger = new Logger(LoginSoftlockService.name);
  private readonly entries = new Map<string, SoftlockEntry>();

  /**
   * Returns true if the (normalized) username is currently locked out.
   * Lock-expiry is enforced lazily — entries are NOT eagerly GC'd.
   */
  isLocked(username: string): boolean {
    return this.lockedUntil(normalizeUsername(username)) > Date.now();
  }

  /**
   * Returns the epoch-ms timestamp at which the lock expires, or 0 if not
   * locked. Used by callers who want to surface a retry-after hint.
   */
  lockedUntil(username: string): number {
    const entry = this.entries.get(normalizeUsername(username));
    if (!entry) return 0;
    return entry.lockedUntil;
  }

  /**
   * Records a failed login attempt. Triggers a 15-minute lockout once
   * SOFTLOCK_MAX_FAILS failures are observed within a single window.
   */
  recordFailure(username: string): void {
    const key = normalizeUsername(username);
    const now = Date.now();
    const existing = this.entries.get(key);

    if (!existing || now - existing.firstFailureAt > SOFTLOCK_FAILS_WINDOW_MS) {
      this.entries.set(key, {
        count: 1,
        lockedUntil: 0,
        firstFailureAt: now,
      });
      return;
    }

    const nextCount = existing.count + 1;
    const lockedUntil =
      nextCount >= SOFTLOCK_MAX_FAILS ? now + SOFTLOCK_DURATION_MS : 0;

    this.entries.set(key, {
      count: nextCount,
      lockedUntil,
      firstFailureAt: existing.firstFailureAt,
    });

    if (nextCount === SOFTLOCK_MAX_FAILS && lockedUntil > 0) {
      this.logger.warn(
        `Login softlock TRIGGERED username=${key} lockedUntil=${new Date(
          lockedUntil,
        ).toISOString()}`,
      );
    }
  }

  /**
   * Clears the softlock bucket on successful login. Idempotent.
   */
  reset(username: string): void {
    this.entries.delete(normalizeUsername(username));
  }

  /**
   * Test-only helper. NOT exported from the module barrel file.
   * Production code never invokes this; it's only here so unit tests can
   * start from a clean slate.
   */
  __resetForTests(): void {
    this.entries.clear();
  }
}
