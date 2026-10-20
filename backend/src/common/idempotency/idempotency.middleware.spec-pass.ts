/**
 * TZ-247 — Quick smoke test for IdempotencyMiddleware (pass-through cases).
 *
 * Imported via jest per the prior spec file's import path; the original
 * spec was rewritten in-place above for cleaner assertions.
 */
import { Test } from '@nestjs/testing';
import { IdempotencyMiddleware } from './idempotency.middleware';
import { IdempotencyStorageService } from './idempotency-storage.service';

describe('IdempotencyMiddleware pass-through', () => {
  it('exposes middleware as DI service', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        IdempotencyMiddleware,
        { provide: IdempotencyStorageService, useValue: { findByKey: jest.fn(), insert: jest.fn() } },
      ],
    }).compile();
    const instance = moduleRef.get(IdempotencyMiddleware);
    expect(typeof instance.use).toBe('function');
  });
});
