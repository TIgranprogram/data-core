import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  Idempotency,
  IdempotencyDocument,
} from './idempotency-storage.schema';

/**
 * TZ-247 — Idempotency storage service.
 *
 * Persists idempotency records in MongoDB. The middleware calls into
 * this service for `findByKey` (replay detection) and `insert` (cache
 * the response on success). Records self-expire via Mongo TTL index.
 */
@Injectable()
export class IdempotencyStorageService {
  constructor(
    @InjectModel(Idempotency.name)
    private readonly model: Model<IdempotencyDocument>,
  ) {}

  async findByKey(key: string): Promise<IdempotencyDocument | null> {
    return this.model.findOne({ idempotencyKey: key }).exec();
  }

  /**
   * Insert an idempotency record. All fields of the Idempotency shape
   * are required — there is no omit/pre-pick here. Mongoose spec read
   * at the document-creation call-site. Upsert with `$setOnInsert` makes
   * this safe against concurrent first-write races.
   */
  async insert(record: Idempotency): Promise<void> {
    await this.model.updateOne(
      { idempotencyKey: record.idempotencyKey },
      { $setOnInsert: record },
      { upsert: true },
    ).exec();
  }

  /**
   * TZ-247.B — E11000-race-safe insert.
   *
   * Two concurrent first-callers with the same `Idempotency-Key` will
   * both pass `findByKey === null`. With a `Model.insertOne`-style path,
   * the second callsite's insert would throw a Mongo duplicate-key
   * error (code 11000). With the `$setOnInsert` upsert path used by
   * `insert()`, the second call is a benign no-op — BUT the canonical
   * record is still the FIRST caller's, which the loser's middleware
   * would also persist over the wire by itself. To make the contract
   * explicit, this method:
   *
   *   1. attempts the upsert;
   *   2. catches Mongo error code 11000 and re-fetches the canonical
   *      record (the WINNER's data);
   *   3. non-E11000 errors are re-thrown (caller can fail the request);
   *   4. always returns the canonical document so the middleware can
   *      record the WINNER's identity rather than the loser's.
   *
   * Defensive: if `findByKey` returns null AFTER a successful upsert
   * (extremely rare — replication lag / write-concern race), throw a
   * descriptive error so the caller can fail-loud.
   */
  async insertOrFetch(record: Idempotency): Promise<IdempotencyDocument> {
    try {
      await this.model
        .updateOne(
          { idempotencyKey: record.idempotencyKey },
          { $setOnInsert: record },
          { upsert: true },
        )
        .exec();
    } catch (err) {
      const code = (err as { code?: number } | undefined)?.code;
      if (code !== 11000) throw err;
      // E11000: some other writer won. Fall through to findByKey below.
    }
    const winner = await this.findByKey(record.idempotencyKey);
    if (!winner) {
      throw new Error(
        `IdempotencyStorageService.insertOrFetch: canonical record missing for key=${record.idempotencyKey} after upsert`,
      );
    }
    return winner;
  }
}
