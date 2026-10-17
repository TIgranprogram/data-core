import { sha256Hex, randomSecret, secretPrefix, MIN_SECRET_BYTES } from './device-crypto';

describe('device-crypto (TZ-AUTH-303)', () => {
  it('sha256Hex is deterministic and hex-encoded', () => {
    expect(sha256Hex('abc')).toBe(sha256Hex('abc'));
    expect(sha256Hex('abc')).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256Hex('abc')).not.toBe(sha256Hex('abd'));
  });

  it('randomSecret respects the requested byte count (base64url)', () => {
    const s = randomSecret(32);
    expect(s.length).toBeGreaterThanOrEqual(40); // 32 bytes -> 43 base64url chars
    expect(s).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('randomSecret never falls below MIN_SECRET_BYTES', () => {
    const s = randomSecret(8);
    // 24 bytes minimum -> 32 base64url chars
    expect(s.length).toBeGreaterThanOrEqual(32);
    expect(MIN_SECRET_BYTES).toBe(24);
  });

  it('secretPrefix returns a bounded display-only fragment', () => {
    expect(secretPrefix('abcdefghijklmnop', 12)).toBe('abcdefghijkl');
    expect(secretPrefix('short')).toBe('short');
  });
});
