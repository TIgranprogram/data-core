import { Model, Types } from 'mongoose';
import {
  TextBlock,
  type TextBlockDocument,
} from '../../modules/text-block/text-block.schema';
import { SYSTEM_DEFAULT_TEXT_BLOCK_CATEGORY_SLUG } from '../../modules/text-block-category/text-block-category.schema';
import {
  TextBlockCategory,
  type TextBlockCategoryDocument,
} from '../../modules/text-block-category/text-block-category.schema';

/**
 * TZ-DOC-323 — drop the legacy `category` enum from text-block documents.
 *
 * The `category: 'legal'|'intro'|'outro'|'custom'` field was deprecated in
 * TZ-DOC-315 when the FK `categoryId?: Types.ObjectId` was introduced.
 * TZ-DOC-320 + TZ-DOC-322 fully decoupled the legacy value from `categoryId`
 * resolution; the field was a no-op except for its persistence cost and
 * confusing DTO surface. TZ-DOC-323 removes it from the schema entirely
 * and this migration cleans up existing rows so reports and queries don't
 * see a dangling field.
 *
 * Backfill branch (TZ-DOC-323 amendment):
 *   - If a document has BOTH `category` and `categoryId` set → just
 *     `$unset category`. id was already correctly assigned.
 *   - If a document has `category` set and `categoryId` MISSING / NULL →
 *     look up the system default «Общее» and stamp `categoryId`. Log a
 *     warning when no system default exists (operator-actionable).
 *   - If a document has no `category` → noop.
 *
 * CRITICAL implementation detail:
 *   After the schema-level removal, calling `model.updateMany(...)` is
 *   unreliable: Mongoose runs the update through its strict-mode schema
 *   cast, and `$unset: { category: '' }` is stripped because `category`
 *   is no longer a known schema path. The result is a silent no-op
 *   ($unset body becomes empty) that nevertheless reports
 *   `{ modifiedCount: <matched> }` because Mongo considered the request
 *   as "matched and rewritten" — but the field never actually got
 *   removed. We therefore use `model.collection.updateMany(...)` which
 *   bypasses the Mongoose schema layer.
 *
 *   Verified empirically in the TZ-DOC-323 probe: `$unset via
 *   collection.updateMany` → `category` field actually missing from the
 *   document after the call. `model.updateMany` → no removal happens.
 *
 * Post-migration index cleanup:
 *   The two compound indexes on `category` (`{category, sortOrder}` /
 *   `{category, isActive}`) that were part of the original schema are
 *   dropped at the end of the migration. They become dead weight once
 *   the field is gone — every read is best served by `{categoryId,
 *   isActive}`. Use `dropIndex` guarded by `listIndexes` so an
 *   already-pruned database is a no-op.
 *
 * Idempotency: every branch is "$exists: true" → "$unset", so a second
 * run finds nothing to update; modifiedCount = 0; the index drop is
 * idempotent (we only call `dropIndex` for indexes actually present).
 *
 * SAFETY:
 *   - Side-effect bounded to a single `$unset` field write + a single
 *     `categoryId` stamp on orphaned legacy rows + index drop.
 *   - Does NOT mutate other schema fields.
 *   - Reports matched / modified counts for ops audit.
 *   - Refuses to backfill (only logs `{backfill_skipped: N}`) when the
 *     system-default category is missing — operator-actionable signal.
 *
 * DOWN (best-effort):
 *   The `category` *value* cannot be reconstructed from current state
 *   once unset — we deliberately do not maintain a side-table mapping
 *   `{_id → category}` because the legacy caller profile is empty in
 *   production post-TZ-DOC-316. Rollback strategy: revert this TZ's
 *   commit + drivers from the feature branch.
 *
 * RUNTIME INVOCATION (manual, sibling of TZ-DOC-307 migration):
 *   `npx ts-node backend/src/database/migrations/2026-08-02-TZ-DOC-323-remove-legacy-text-block-category.ts`
 *   Override `MONGO_URI` env to point at a specific DB.
 */
export async function runTZDOC323RemoveLegacyCategoryMigration(
  textBlockModel: Model<TextBlockDocument>,
  categoryModel?: Model<TextBlockCategoryDocument>,
): Promise<{
  unsetCount: number;
  backfilledCount: number;
  backfillSkipped: number;
  indexesDropped: string[];
}> {
  const coll = textBlockModel.collection;

  // ── Branch 1: docs with both `category` and `categoryId` → just $unset
  const onlyUnset = await coll.updateMany(
    { category: { $exists: true }, categoryId: { $exists: true, $ne: null } },
    { $unset: { category: '' } },
  );
  let backfillSkipped = 0;
  let backfilledCount = 0;

  // ── Branch 2: docs with `category` set but no `categoryId` → backfill
  if (categoryModel) {
    const sysDefault = await categoryModel
      .findOne({ slug: SYSTEM_DEFAULT_TEXT_BLOCK_CATEGORY_SLUG, isSystem: true })
      .exec();
    if (!sysDefault) {
      console.log(
        `[TZ-DOC-323] WARN: System default «Общее» not found — legacy ` +
          `rows without categoryId will be left untouched. Start the backend ` +
          `once so TextBlockCategoriesSeed can create it, then re-run.`,
      );
      backfillSkipped = await coll.countDocuments({
        category: { $exists: true },
        $or: [{ categoryId: { $exists: false } }, { categoryId: null }],
      });
    } else {
      const backfillRes = await coll.updateMany(
        {
          category: { $exists: true },
          $or: [{ categoryId: { $exists: false } }, { categoryId: null }],
        },
        {
          $unset: { category: '' },
          $set: { categoryId: new Types.ObjectId(sysDefault._id) },
        },
      );
      backfilledCount = backfillRes.modifiedCount ?? 0;
    }
  } else {
    // No categoryModel supplied: just count, do not backfill.
    backfillSkipped = await coll.countDocuments({
      category: { $exists: true },
      $or: [{ categoryId: { $exists: false } }, { categoryId: null }],
    });
  }

  // ── Index cleanup (idempotent)
  const indexesDropped: string[] = [];
  const indexes = await coll.indexes();
  for (const idx of indexes) {
    if (idx.name && /^category_/.test(idx.name)) {
      try {
        await coll.dropIndex(idx.name);
        indexesDropped.push(idx.name);
      } catch (err) {
        console.log(
          `[TZ-DOC-323] dropIndex ${idx.name} skipped: ${(err as Error).message}`,
        );
      }
    }
  }

  console.log(
    `[TZ-DOC-323] Summary: ${onlyUnset.modifiedCount ?? 0} ` +
      `category-with-categoryId rows unset, ${backfilledCount} orphaned ` +
      `rows backfilled to system default, ${backfillSkipped} skipped. ` +
      `Indexes dropped: [${indexesDropped.join(', ') || 'none'}].`,
  );

  return {
    unsetCount: onlyUnset.modifiedCount ?? 0,
    backfilledCount,
    backfillSkipped,
    indexesDropped,
  };
}

/** Self-invocation guard: runs only when executed directly via ts-node. */
if (require.main === module) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mongoose = require('mongoose');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { TextBlockSchema } = require('../../modules/text-block/text-block.schema');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { TextBlockCategorySchema } = require('../../modules/text-block-category/text-block-category.schema');
  (async () => {
    await mongoose.connect(process.env.MONGO_URI ?? 'mongodb://localhost:27017/kppdf');
    try {
      const tbModel = mongoose.model(TextBlock.name, TextBlockSchema);
      const catModel = mongoose.model(TextBlockCategory.name, TextBlockCategorySchema);
      await runTZDOC323RemoveLegacyCategoryMigration(tbModel, catModel);
    } finally {
      await mongoose.disconnect();
    }
  })().catch((err: unknown) => {
    console.error('[TZ-DOC-323] Migration failed:', err);
    process.exitCode = 1;
  });
}
