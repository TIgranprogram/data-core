/**
 * TZ-247 — Idempotency middleware unit tests.
 *
 * These tests cover the middleware LOGIC in isolation. The Mongo harness
 * is NOT used; `IdempotencyStorageService` is mocked via DI token.
 */
import { Test } from '@nestjs/testing';
import { IdempotencyMiddleware } from './idempotency.middleware';
import { IdempotencyStorageService } from './idempotency-storage.service';

describe('IdempotencyMiddleware', () => {
  let middleware: IdempotencyMiddleware;
  let next: jest.Mock;

  const mockStorage = {
    findByKey: jest.fn(),
    insert: jest.fn().mockResolvedValue(undefined),
    insertOrFetch: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        IdempotencyMiddleware,
        { provide: IdempotencyStorageService, useValue: mockStorage },
      ],
    }).compile();
    middleware = moduleRef.get(IdempotencyMiddleware);
    next = jest.fn();
  });

  function fakeReq(method: string, path: string, body: unknown, idemKey: string | null) {
    return {
      method,
      path,
      body,
      header: (h: string) => (h === 'Idempotency-Key' ? idemKey : null),
    } as any;
  }

  function fakeRes() {
    const r: any = {
      statusCode: 200,
      _body: undefined as unknown,
      status(c: number) { r.statusCode = c; return r; },
      json(b: unknown) { r._body = b; return r; },
    };
    return r;
  }

  it('passes through GET requests', async () => {
    await middleware.use(fakeReq('GET', '/api/foo', null, 'abc'), fakeRes(), next);
    expect(mockStorage.findByKey).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('passes through POST without Idempotency-Key header', async () => {
    await middleware.use(fakeReq('POST', '/api/foo', { x: 1 }, null), fakeRes(), next);
    expect(mockStorage.findByKey).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('passes through excluded /auth/* paths even with key', async () => {
    await middleware.use(fakeReq('POST', '/auth/login', { password: 'x' }, 'abc'), fakeRes(), next);
    expect(mockStorage.findByKey).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('replays cached response when key + fingerprint match', async () => {
    // SHA-256 of "POST|/api/foo|{\"x\":1}" — must equal the fingerprint
    // the middleware computes internally. Literal hex string (not a Jest
    // matcher) so the deep-equal compare succeeds.
    mockStorage.findByKey.mockResolvedValueOnce({
      idempotencyKey: 'abc',
      requestFingerprint: 'd0a028cd092ac938b4b4b05fe3896568837e164169746dfc3a2572a11e31a1dd',
      httpStatus: 201,
      cachedResponse: { id: 'xyz' },
    });
    const res = fakeRes();
    await middleware.use(fakeReq('POST', '/api/foo', { x: 1 }, 'abc'), res, next);
    expect(res.statusCode).toBe(201);
    expect(res._body).toEqual({ id: 'xyz' });
    expect(next).not.toHaveBeenCalled(); // replay short-circuits
  });

  it('returns 409 when key reused with different fingerprint', async () => {
    mockStorage.findByKey.mockResolvedValueOnce({
      idempotencyKey: 'abc',
      requestFingerprint: 'a-different-fingerprint',
      httpStatus: 201,
      cachedResponse: { id: 'xyz' },
    });
    const res = fakeRes();
    await middleware.use(fakeReq('POST', '/api/foo', { x: 1 }, 'abc'), res, next);
    expect(res.statusCode).toBe(409);
    expect(res._body.code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(next).not.toHaveBeenCalled();
  });

  it('skips header but does NOT cache when body too large', async () => {
    const big = 'x'.repeat(300 * 1024);
    const req = fakeReq('POST', '/api/foo', { x: big }, 'abc');
    await middleware.use(req, fakeRes(), next);
    expect(mockStorage.findByKey).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('does NOT cache error responses (4xx)', async () => {
    mockStorage.findByKey.mockResolvedValueOnce(null);
    const res = fakeRes();
    res.statusCode = 422;
    await middleware.use(fakeReq('POST', '/api/foo', { x: 1 }, 'abc'), res, next);
    expect(next).toHaveBeenCalledTimes(1);
    // res.json was wrapped, so trigger it explicitly to test redaction
    res.json({ ok: true });
    expect(mockStorage.insertOrFetch).not.toHaveBeenCalled();
  });

  it('exercises ancestor-Set fallback on JSON-roundtrip-throwing cyclic body (regression: TZ-247 stack-overflow)', async () => {
    // Regression: TZ-247 — POST /api/document-templates returned a Mongoose
    // document (service.create → this.model.create(...)) with an internal
    // cyclic reference ($__ / _doc back-pointing to the document itself).
    // The naive recursive redact() walked the cycle forever →
    // RangeError: Maximum call stack size exceeded.
    //
    // PATH COVERAGE NOTE (audit 2026-08-01): this fixture is a plain JS
    // object whose `doc.$__ = { doc }` reference makes `JSON.stringify`
    // throw synchronously. Therefore this test exercises the
    // ancestor-Set fallback path in `redact()`, NOT the JSON-roundtrip
    // happy path. Real Mongoose documents route through the JSON-roundtrip
    // path (their `toJSON()` breaks internal `$__`/`_doc` cycles before
    // stringify sees them); covering that path at unit-test level
    // requires capturing a real hydrated Mongoose document. Marked as
    // successor work alongside TZ-247.B.
    mockStorage.findByKey.mockResolvedValueOnce(null);
    const res = fakeRes();
    await middleware.use(fakeReq('POST', '/api/foo', { x: 1 }, 'abc'), res, next);
    expect(next).toHaveBeenCalledTimes(1);

    // Build a Mongoose-DOC-SHAPED plain object with a REAL self-cycle so
    // JSON.stringify throws → ancestry-walk fallback path is exercised.
    const doc: Record<string, unknown> = {
      _id: '6a6dd6a4b4012551a62e19e4',
      name: 'Договор',
      _doc: {}, // mirrors Mongoose internal raw-values holder
    };
    doc.$__ = { doc }; // mirrors Mongoose InternalCache back-reference
    doc._doc = { name: 'Договор' };

    // Should NOT throw — the ancestor-Set fallback catches the cycle
    // and surfaces the user's name instead of recursing forever.
    expect(() => res.json(doc)).not.toThrow();

    expect(mockStorage.insertOrFetch).toHaveBeenCalledTimes(1);
    const record = mockStorage.insertOrFetch.mock.calls[0][0];
    // Redaction preserved the useful payload and dropped the cyclic internals.
    expect(record.cachedResponse.name).toBe('Договор');
  });

  it('redacts sensitive keys and does not recurse on plain circular objects', async () => {
    mockStorage.findByKey.mockResolvedValueOnce(null);
    const res = fakeRes();
    await middleware.use(fakeReq('POST', '/api/foo', { x: 1 }, 'abc'), res, next);

    const body: Record<string, unknown> = {
      id: 'x',
      refreshTokenVersion: 3,
      accessToken: 'abc',
      nested: { passwordHash: 'hash', ok: true },
    };
    body.self = body; // plain circular reference — not JSON-serializable

    expect(() => res.json(body)).not.toThrow();

    const record = mockStorage.insertOrFetch.mock.calls[0][0];
    expect(record.cachedResponse.refreshTokenVersion).toBe('[REDACTED]');
    expect(record.cachedResponse.accessToken).toBe('[REDACTED]');
    expect(record.cachedResponse.nested.passwordHash).toBe('[REDACTED]');
    expect(record.cachedResponse.nested.ok).toBe(true);
    // Cycle flagged, not recursed.
    expect(record.cachedResponse.self).toBe('[Circular]');
  });

  // TZ-247.B: insertOrFetch is E11000-race-safe at the STORAGE layer
  // (idempotency-storage.service.ts implements atomic upsert + on-dup-select).
  // The middleware never inspects the resolved value, so the resilience
  // surface here is narrower: insertOrFetch rejection MUST NOT throw
  // through the response cycle. The `.catch` in idempotency.middleware.ts
  // (warn-level log, no rethrow) is the contract under test below.
  it('does NOT propagate insertOrFetch rejection (TZ-247.B E11000 tolerance)', async () => {
    mockStorage.findByKey.mockResolvedValueOnce(null);
    // Simulate storage's atomic insert losing the race to a concurrent
    // first-caller. The middleware contract is to swallow and log, not
    // to surface the E11000 to the HTTP client (whose request already
    // succeeded at the controller level).
    mockStorage.insertOrFetch.mockRejectedValueOnce({
      code: 11000,
      keyPattern: { _id: 1 },
      errmsg:
        'E11000 duplicate key error collection: kppdf.idempotency_records index: idempotencyKey_1 dup key',
    });

    const res = fakeRes();
    await middleware.use(
      fakeReq('POST', '/api/foo', { x: 1 }, 'abc'),
      res,
      next,
    );
    // use() did NOT throw despite insertOrFetch rejection.
    expect(next).toHaveBeenCalledTimes(1);

    // Caller's res.json completes synchronously and the rejection is caught
    // by the middleware's `.catch` (warn-level log) — never propagates.
    expect(() => res.json({ id: 'x' })).not.toThrow();
    expect(res._body).toEqual({ id: 'x' });
    expect(mockStorage.insertOrFetch).toHaveBeenCalledTimes(1);
  });
});
