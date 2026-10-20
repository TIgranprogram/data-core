/**
 * TZ-247.B — Idempotency storage service unit tests.
 *
 * Covers the new `insertOrFetch` API: E11000 race handling,
 * non-E11000 error propagation, defensive null-finder throw.
 *
 * Mongoose model is mocked via DI token; no real Mongo / harness.
 */
import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { IdempotencyStorageService } from './idempotency-storage.service';
import { Idempotency } from './idempotency-storage.schema';

function buildMockModel() {
  return {
    updateOne: jest.fn(),
    findOne: jest.fn(),
  };
}

describe('IdempotencyStorageService.insertOrFetch (TZ-247.B)', () => {
  let svc: IdempotencyStorageService;
  let model: ReturnType<typeof buildMockModel>;
  const record: Idempotency = {
    idempotencyKey: 'k-1',
    requestFingerprint: 'fp-1',
    storedAt: new Date('2026-08-01T00:00:00Z'),
    httpStatus: 201,
    cachedResponse: { id: 'created' },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    model = buildMockModel();
    const moduleRef = await Test.createTestingModule({
      providers: [
        IdempotencyStorageService,
        { provide: getModelToken(Idempotency.name), useValue: model },
      ],
    }).compile();
    svc = moduleRef.get(IdempotencyStorageService);
  });

  it('returns the canonical winner record after a successful upsert', async () => {
    const winner = {
      idempotencyKey: 'k-1',
      requestFingerprint: 'fp-1',
      storedAt: new Date('2026-08-01T00:00:00Z'),
      httpStatus: 201,
      cachedResponse: { id: 'created' },
    };
    model.updateOne.mockReturnValue({ exec: jest.fn().mockResolvedValue({ upsertedCount: 1 }) });
    model.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(winner) });

    const result = await svc.insertOrFetch(record);
    expect(model.updateOne).toHaveBeenCalledTimes(1);
    expect(model.updateOne).toHaveBeenCalledWith(
      { idempotencyKey: 'k-1' },
      { $setOnInsert: record },
      { upsert: true },
    );
    expect(model.findOne).toHaveBeenCalledWith({ idempotencyKey: 'k-1' });
    expect(result).toEqual(winner);
  });

  it('catches an E11000 (Mongo duplicate-key) error and still returns the WINNER record via re-fetch', async () => {
    const winner = {
      idempotencyKey: 'k-1',
      requestFingerprint: 'OTHER_FP',
      storedAt: new Date('2026-08-01T00:00:00Z'),
      httpStatus: 200,
      cachedResponse: { id: 'winner' },
    };
    // simulate the second concurrent caller whose upsert throws E11000
    model.updateOne.mockReturnValue({
      exec: jest.fn().mockRejectedValue({ code: 11000, message: 'E11000 duplicate key' }),
    });
    model.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(winner) });

    const result = await svc.insertOrFetch(record);
    expect(result).toEqual(winner);
    // critical: the WINNER's requestFingerprint stays, not the loser's
    expect(result.requestFingerprint).toBe('OTHER_FP');
  });

  it('re-throws non-E11000 errors (does NOT swallow e.g. network failures)', async () => {
    model.updateOne.mockReturnValue({
      exec: jest.fn().mockRejectedValue(new Error('mongo connection refused')),
    });
    await expect(svc.insertOrFetch(record)).rejects.toThrow('mongo connection refused');
    // never re-fetched because the error wasn't E11000
    expect(model.findOne).not.toHaveBeenCalled();
  });

  it('throws if findByKey returns null even after a successful (non-throwing) upsert (defensive)', async () => {
    model.updateOne.mockReturnValue({ exec: jest.fn().mockResolvedValue({}) });
    model.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
    await expect(svc.insertOrFetch(record)).rejects.toThrow(
      /IdempotencyStorageService\.insertOrFetch: canonical record missing/,
    );
  });
});
