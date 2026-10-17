import { Model } from 'mongoose';
import {
  DocumentTemplate,
  DocumentTemplateDocument,
  DocumentTemplateSchema,
} from '../../modules/document-template/document-template.schema';
import { BLANK_A4_SENTINEL_TAG } from '../../modules/document-template/blank-a4-template.constants';

/**
 * TZ-NX-DOCSTUDIO-TEMPLATES-NO-SENTINEL-SPAM — one-shot cleanup for a live DB
 * that already accumulated duplicate `system-sentinel-blank-a4` templates
 * before this TZ (audit 2026-09-12: an admin JWT with no org sees every
 * organization's sentinel via the old unscoped `findAll`, plus create races
 * before `ensureBlankA4Sentinel` was hardened to dedupe on every call).
 *
 * Per org, keeps the OLDEST non-deleted sentinel and soft-deletes
 * (`deletedAt = now`) every other one — never a hard wipe. Safe to run
 * before the schema's new unique partial index
 * (`{organizationId, tags}` where `tags` contains the sentinel tag) is
 * built, so that index doesn't fail on pre-existing duplicates.
 *
 * Idempotent: a second run finds at most one candidate per org and dedupes 0.
 *
 * RUNTIME INVOCATION (manual, per TZ-240 convention):
 *   `npx ts-node backend/src/database/migrations/2026-09-12-TZ-NX-DOCSTUDIO-TEMPLATES-NO-SENTINEL-SPAM-dedup-sentinels.ts`
 */
export interface DedupBlankA4SentinelsResult {
  organizationsChecked: number;
  organizationsWithDuplicates: number;
  softDeleted: number;
}

export async function runDedupBlankA4SentinelsMigration(
  templateModel: Model<DocumentTemplateDocument>,
): Promise<DedupBlankA4SentinelsResult> {
  const candidates = await templateModel
    .find({ tags: BLANK_A4_SENTINEL_TAG, deletedAt: null })
    .sort({ createdAt: 1 })
    .exec();

  const byOrg = new Map<string, DocumentTemplateDocument[]>();
  for (const doc of candidates) {
    const orgKey = String(doc.organizationId);
    const group = byOrg.get(orgKey);
    if (group) group.push(doc);
    else byOrg.set(orgKey, [doc]);
  }

  let organizationsWithDuplicates = 0;
  let softDeleted = 0;
  for (const [orgKey, docs] of byOrg) {
    if (docs.length <= 1) continue;
    const [, ...duplicates] = docs;
    await templateModel
      .updateMany(
        { _id: { $in: duplicates.map((doc) => doc._id) } },
        { $set: { deletedAt: new Date() } },
      )
      .exec();
    organizationsWithDuplicates += 1;
    softDeleted += duplicates.length;
    console.log(
      `[TZ-NX-DOCSTUDIO-TEMPLATES-NO-SENTINEL-SPAM] org ${orgKey}: kept 1, soft-deleted ${duplicates.length} duplicate sentinel(s)`,
    );
  }

  return {
    organizationsChecked: byOrg.size,
    organizationsWithDuplicates,
    softDeleted,
  };
}

/** Self-invocation guard: runs only when executed directly via ts-node. */
if (require.main === module) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mongoose = require('mongoose');
  (async () => {
    await mongoose.connect(process.env.MONGO_URI ?? 'mongodb://localhost:27017/kppdf');
    try {
      const templateModel = mongoose.model(DocumentTemplate.name, DocumentTemplateSchema);
      const result = await runDedupBlankA4SentinelsMigration(templateModel);
      console.log('[TZ-NX-DOCSTUDIO-TEMPLATES-NO-SENTINEL-SPAM] Result:', result);
    } finally {
      await mongoose.disconnect();
    }
  })().catch((err) => {
    console.error('[TZ-NX-DOCSTUDIO-TEMPLATES-NO-SENTINEL-SPAM] Migration failed:', err);
    process.exitCode = 1;
  });
}
