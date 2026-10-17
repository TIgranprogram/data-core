import { createHash } from 'node:crypto';

/**
 * TZ-CORE-301 — Snapshot-on-transition immutability pattern.
 *
 * Problem (docs/compose/plans/2026-08-02-shop-customer-lifecycle.md §3 / §7 #16):
 * FK-only references on stage transitions leak catalog edits into archived
 * orders/specifications/shipments. Q9 default: denormalize per stage, not a
 * mega-collection.
 *
 * This module provides the *contract* + *pure helper* for inline snapshots.
 * It is SessionRunner-friendly: no DI, no DB writes — callers embed the
 * snapshot into their own stage document inside the same transaction.
 *
 * Contract — what we store per stage transition:
 *   `_snapshot: {
 *     stage:    'order' | 'specification' | 'shipment' | string,
 *     capturedAt: ISO date,
 *     sourceId: string | null,     // entity id the snapshot was derived from
 *     hash:     sha256 of the frozen payload (integrity fingerprint),
 *     version:  1,
 *   }`
 * plus a deep-frozen copy of the payload fields that must never change after
 * the transition (e.g. order items at approve-time).
 *
 * NOT in scope (known_limitation): full catalog denormalization migration,
 * mega-collection, legacy Proposal/Quotation merge.
 */

export interface SnapshotMeta {
  stage: string;
  capturedAt: string;
  sourceId: string | null;
  hash: string;
  version: 1;
}

export interface InlineSnapshot<T> {
  /** Immutable copy of the captured stage payload. */
  data: Readonly<T>;
  /** Integrity + provenance metadata. */
  _snapshot: SnapshotMeta;
}

/** Deep-clone that also prevents prototype pollution from untrusted input. */
export function cloneImmutable<T>(value: T): Readonly<T> {
  const cloned = structuredClone(value);
  return deepFreeze(cloned);
}

/** Recursively freeze a cloned value (shallow Object.freeze is insufficient). */
function deepFreeze<T>(value: T): Readonly<T> {
  if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value as Readonly<T>;
}

/** sha256 hex fingerprint of a stable serialization (sorted keys). */
export function snapshotHash(value: unknown): string {
  const stable = JSON.stringify(value, stableStringifyReplacer);
  return createHash('sha256').update(stable).digest('hex');
}

/**
 * Create an inline snapshot of `payload` at `stage`.
 *
 * Usage (inside a SessionRunner transaction):
 *   const snapshot = createInlineSnapshot(order, { stage: 'order' });
 *   spec.snapshot = snapshot;            // or any other storage shape
 *   await spec.save({ session });
 *
 * `sourceId` should be the originating document's id so the archive can link
 * back to a historical snapshot even after the live document is edited.
 */
export function createInlineSnapshot<T>(
  payload: T,
  opts: { stage: string; sourceId?: string | null; capturedAt?: Date },
): InlineSnapshot<T> {
  const data = cloneImmutable(payload);
  const capturedAt = (opts.capturedAt ?? new Date()).toISOString();
  const _snapshot: SnapshotMeta = {
    stage: opts.stage,
    capturedAt,
    sourceId: opts.sourceId ?? null,
    hash: snapshotHash(data),
    version: 1,
  };
  return { data, _snapshot };
}

/**
 * Verify that a stored snapshot still matches `current` bytes. Returns false
 * when the document was tampered with after capture (hash mismatch).
 */
export function snapshotMatches<T>(
  stored: Pick<InlineSnapshot<T>, '_snapshot'>,
  current: T,
): boolean {
  return stored._snapshot.hash === snapshotHash(current);
}

/**
 * Stable replacer: sorts object keys so `{a,b}` hashes equal `{b,a}`.
 * Primitives are returned as-is; `undefined` fields are dropped.
 */
function stableStringifyReplacer(_key: string, value: unknown): unknown {
  if (value === undefined) return undefined;
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    return Object.keys(record)
      .sort()
      .reduce<Record<string, unknown>>((acc, k) => {
        if (record[k] !== undefined) acc[k] = record[k];
        return acc;
      }, {});
  }
  return value;
}
