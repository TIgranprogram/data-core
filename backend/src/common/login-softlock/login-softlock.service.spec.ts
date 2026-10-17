import { LoginSoftlockService } from './login-softlock.service';

/**
 * TZ-249 §2.4 unit tests.
 *
 * Time control: instead of sandboxing Date.now with offsets from real
 * wall-clock (which would couple test stability to the OS clock), the
 * suite uses a single frozen `FROZEN_BASE` variable; `freezeTo()` sets it
 * and `advanceBy()` increments it. `isLocked()` consults `Date.now()` —
 * patched to return `FROZEN_BASE` while the suite runs.
 */
describe('LoginSoftlockService (TZ-249 §2.4)', () => {
  let svc: LoginSoftlockService;
  const ORIGINAL_NOW = Date.now;
  let FROZEN_BASE = 0;

  beforeEach(() => {
    svc = new LoginSoftlockService();
    svc.__resetForTests();
    FROZEN_BASE = 0;
    Date.now = () => FROZEN_BASE;
  });

  afterEach(() => {
    Date.now = ORIGINAL_NOW;
  });

  function freezeTo(epochMs: number): void {
    FROZEN_BASE = epochMs;
    Date.now = () => FROZEN_BASE;
  }

  function advanceBy(ms: number): void {
    FROZEN_BASE += ms;
    Date.now = () => FROZEN_BASE;
  }

  it('is NOT locked before any failure is recorded', () => {
    freezeTo(1_700_000_000_000);
    expect(svc.isLocked('alice')).toBe(false);
    expect(svc.lockedUntil('alice')).toBe(0);
  });

  it('counts up to 4 failures without triggering the lockout', () => {
    freezeTo(1_700_000_000_000);
    svc.recordFailure('alice');
    svc.recordFailure('alice');
    svc.recordFailure('alice');
    svc.recordFailure('alice');
    expect(svc.isLocked('alice')).toBe(false);
    expect(svc.lockedUntil('alice')).toBe(0);
  });

  it('triggers a 15-minute softlock on the 5th failure', () => {
    freezeTo(1_700_000_000_000);
    for (let i = 0; i < 5; i++) {
      svc.recordFailure('alice');
    }
    expect(svc.isLocked('alice')).toBe(true);
    const until = svc.lockedUntil('alice');
    expect(until).toBe(1_700_000_000_000 + 15 * 60 * 1000);
  });

  it('keeps the softlock active 14m59s after trigger, but lifted at 15m01s', () => {
    freezeTo(1_700_000_000_000);
    for (let i = 0; i < 5; i++) {
      svc.recordFailure('alice');
    }
    // 14m59s — still locked (1 second remaining on the 15 minute clock)
    advanceBy(14 * 60 * 1000 + 59 * 1000);
    expect(svc.isLocked('alice')).toBe(true);
    // 15m+1s — clock has elapsed exactly past the lock expiry
    advanceBy(2 * 1000);
    expect(svc.isLocked('alice')).toBe(false);
  });

  it('normalizes username (trim + lowercase) so casing/whitespace cannot bypass', () => {
    freezeTo(1_700_000_000_000);
    for (let i = 0; i < 5; i++) {
      svc.recordFailure('  Alice  ');
    }
    // Different surface formattings must still see the lock.
    expect(svc.isLocked('alice')).toBe(true);
    expect(svc.isLocked('ALICE')).toBe(true);
    expect(svc.isLocked('  alice  ')).toBe(true);
  });

  it('resets the bucket when reset() is called (successful login)', () => {
    freezeTo(1_700_000_000_000);
    svc.recordFailure('alice');
    svc.recordFailure('alice');
    svc.recordFailure('alice');
    svc.reset('alice');
    expect(svc.isLocked('alice')).toBe(false);
    expect(svc.lockedUntil('alice')).toBe(0);
  });

  it('palette-mixed usernames ( Admin / ADMIN / admin ) share a single bucket', () => {
    freezeTo(1_700_000_000_000);
    svc.recordFailure('Admin');
    svc.recordFailure('ADMIN');
    svc.recordFailure('admin');
    svc.recordFailure('admin');
    expect(svc.isLocked('admin')).toBe(false); // 4 total
    svc.recordFailure('  ADMIN  ');
    expect(svc.isLocked('admin')).toBe(true); // 5th
  });

  it('resets the window when the last failure is older than 15 minutes (slow attacker)', () => {
    freezeTo(1_700_000_000_000);
    for (let i = 0; i < 4; i++) {
      svc.recordFailure('alice');
    }
    expect(svc.isLocked('alice')).toBe(false);
    // advance past 15-min failure window
    advanceBy(15 * 60 * 1000 + 1000);
    // a fresh failure after the window reset must NOT inherit the count
    svc.recordFailure('alice');
    expect(svc.isLocked('alice')).toBe(false);
  });

  it('keeps usernames isolated (one user is unaffected by another', () => {
    freezeTo(1_700_000_000_000);
    for (let i = 0; i < 5; i++) {
      svc.recordFailure('alice');
    }
    expect(svc.isLocked('alice')).toBe(true);
    expect(svc.isLocked('bob')).toBe(false);
  });

  it('resetting one username does not affect another', () => {
    freezeTo(1_700_000_000_000);
    for (let i = 0; i < 5; i++) {
      svc.recordFailure('alice');
    }
    svc.reset('bob'); // bob has no entry; no-op
    expect(svc.isLocked('alice')).toBe(true);
  });
});
