import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

/**
 * TZ-247 — Idempotency storage schema.
 *
 * Stores completed responses keyed by Idempotency-Key so a retry of the
 * SAME mutating request returns the cached result instead of creating a
 * duplicate resource.
 *
 * Lifecycle:
 *   - On a successful POST/PATCH/PUT/DELETE response with Idempotency-Key,
 *     middleware writes cachedResponse keyed by idempotencyKey + requestFingerprint.
 *   - On replay with same key + same fingerprint: return cached response (200/201).
 *   - On replay with same key + DIFFERENT fingerprint: 409 conflict.
 *   - TTL index on storedAt expires records after `IDEMPOTENCY_TTL_HOURS`.
 */
export type IdempotencyDocument = HydratedDocument<Idempotency>;

@Schema({ softDelete: false,  collection: 'idempotency_records', timestamps: false })
export class Idempotency {
  @Prop({ required: true, unique: true, index: true })
  idempotencyKey!: string;

  /** SHA-256 of `METHOD+PATH+sorted-body-bytes` — catches key reuse with different payload. */
  @Prop({ required: true })
  requestFingerprint!: string;

  @Prop({ required: true })
  storedAt!: Date;

  @Prop({ required: true })
  httpStatus!: number;

  /** Cached response body. Sensitive fields (passwordHash/refreshTokenVersion/<256KB bodies)
   *  are redacted before storage by the middleware service. Verified by `idempotency.middleware.spec.ts`. */
  @Prop({ type: Object, required: true })
  cachedResponse!: Record<string, unknown>;
}

export const IdempotencySchema = SchemaFactory.createForClass(Idempotency);

// TTL index — automatically purge records after `IDEMPOTENCY_TTL_HOURS` hours
// (default 24h). Mongoose TTL runs every 60s — expire granularity is per-minute.
// Index using `storedAt` + Mongo `expireAfterSeconds`. Note: TTL is best-effort
// (background sweeper); records can live up to ~60s past expiration.
IdempotencySchema.index({ storedAt: 1 }, { expireAfterSeconds: 24 * 3600 });
