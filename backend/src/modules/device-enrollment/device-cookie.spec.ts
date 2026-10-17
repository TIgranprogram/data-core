import { readCookie, setDeviceCookie, clearDeviceCookie } from './device-cookie';

function fakeRes() {
  const cookies: Record<string, string> = {};
  const res = {
    cookie(name: string, value: string, opts: Record<string, unknown>) {
      cookies[name] = JSON.stringify({ value, opts });
    },
    clearCookie(name: string, opts: Record<string, unknown>) {
      cookies[name] = JSON.stringify({ cleared: true, opts });
    },
    cookies,
  };
  return res as unknown as {
    cookie(n: string, v: string, o: Record<string, unknown>): void;
    clearCookie(n: string, o: Record<string, unknown>): void;
    cookies: Record<string, string>;
  };
}

describe('device-cookie (TZ-AUTH-303)', () => {
  it('readCookie extracts an exact cookie name from the header', () => {
    const req = {
      headers: {
        cookie: '__Host-kppdf-device=secret.abc; refreshToken=zzz',
      },
    } as unknown as Parameters<typeof readCookie>[0];
    expect(readCookie(req, '__Host-kppdf-device')).toBe('secret.abc');
    expect(readCookie(req, 'missing')).toBeUndefined();
  });

  it('readCookie returns undefined without a Cookie header', () => {
    const req = { headers: {} } as unknown as Parameters<typeof readCookie>[0];
    expect(readCookie(req, '__Host-kppdf-device')).toBeUndefined();
  });

  it('setDeviceCookie writes a hardened __Host- cookie', () => {
    const res = fakeRes();
    setDeviceCookie(res as never, '__Host-kppdf-device', 'secret.abc', 86400000);
    const { value, opts } = JSON.parse(res.cookies['__Host-kppdf-device']) as {
      value: string;
      opts: Record<string, unknown>;
    };
    expect(value).toBe('secret.abc');
    expect(opts.httpOnly).toBe(true);
    expect(opts.secure).toBe(true);
    expect(opts.sameSite).toBe('lax');
    expect(opts.path).toBe('/');
    expect(opts.domain).toBeUndefined();
    expect(opts.maxAge).toBe(86400000);
  });

  it('clearDeviceCookie clears the cookie', () => {
    const res = fakeRes();
    clearDeviceCookie(res as never, '__Host-kppdf-device');
    expect(JSON.parse(res.cookies['__Host-kppdf-device']).cleared).toBe(true);
  });
});
