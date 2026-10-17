import { Model } from 'mongoose';
import {
  DocumentTemplate,
  DocumentTemplateDocument,
} from '../../modules/document-template/document-template.schema';
import {
  DocumentTemplateCategory,
  DocumentTemplateCategoryDocument,
} from '../../modules/document-template-category/document-template-category.schema';
import { SYSTEM_DEFAULT_CATEGORY_SLUG } from '../../modules/document-template-category/document-template-category.service';

/**
 * TZ-DOC-307 — legacy document templates backfill.
 *
 * Goal: every template created BEFORE categories existed (no `categoryId`)
 * is assigned the active system default «Общее». Read compatibility alone
 * is guaranteed by the optional schema field; this migration makes the
 * data fully categorized so category filtering / reporting is complete.
 *
 * Idempotency: the `$or` query only matches documents where categoryId is
 * missing (or null). Re-running after a successful run is safe.
 *
 * SAFETY:
 *   - No-op when the system default does not exist (fresh DB before the
 *     seed boots) — the operator sees a log line instead of a silent skip.
 *   - Side-effects are bounded to a single-field write.
 *
 * RUNTIME INVOCATION (manual, per TZ-240 convention):
 *   `npx ts-node backend/src/database/migrations/2026-08-02-TZ-DOC-307-backfill-template-categories.ts`
 */
export async function runTZDOC307BackfillMigration(
  templateModel: Model<DocumentTemplateDocument>,
  categoryModel: Model<DocumentTemplateCategoryDocument>,
): Promise<void> {
  const systemDefault = await categoryModel
    .findOne({ slug: SYSTEM_DEFAULT_CATEGORY_SLUG, isSystem: true })
    .exec();
  if (!systemDefault) {
    console.log(
      '[TZ-DOC-307] System default category «Общее» not found. ' +
        'Start the backend once so DocumentTemplateCategoriesSeed can create it, then re-run the migration.',
    );
    return;
  }

  const filter = {
    $or: [{ categoryId: { $exists: false } }, { categoryId: null }],
  };
  const result = await templateModel
    .updateMany(filter, { $set: { categoryId: systemDefault._id } })
    .exec();

  console.log(
    `[TZ-DOC-307] Backfilled ${result.modifiedCount} legacy templates → category ${systemDefault._id} («Общее»)`,
  );
}

/** Self-invocation guard: runs only when executed directly via ts-node. */
if (require.main === module) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mongoose = require('mongoose');
  (async () => {
    await mongoose.connect(process.env.MONGO_URI ?? 'mongodb://localhost:27017/kppdf');
    try {
      await runTZDOC307BackfillMigration(
        mongoose.model(DocumentTemplate.name),
        mongoose.model(DocumentTemplateCategory.name),
      );
    } finally {
      await mongoose.disconnect();
    }
  })().catch((err) => {
    console.error('[TZ-DOC-307] Migration failed:', err);
    process.exitCode = 1;
  });
}
