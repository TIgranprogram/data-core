import mongoose, { type Model } from 'mongoose';
import { Material, MaterialSchema, type MaterialDocument } from '../../modules/material/material.schema';

export interface TZCatalog301MigrationResult {
  matchedCount: number;
  modifiedCount: number;
}

/**
 * TZ-CATALOG-301: classify legacy Material rows that predate materialKind.
 *
 * Only rows where the field is missing or explicitly null are touched. Existing
 * classifications are preserved. The collection-level update avoids a future
 * strict-schema cast turning this compatibility backfill into a silent no-op.
 */
export async function runTZCatalog301MaterialFieldsMigration(
  materialModel: Model<MaterialDocument>,
): Promise<TZCatalog301MigrationResult> {
  const result = await materialModel.collection.updateMany(
    {
      $or: [{ materialKind: { $exists: false } }, { materialKind: null }],
    },
    { $set: { materialKind: 'other' } },
  );

  const summary = {
    matchedCount: result.matchedCount ?? 0,
    modifiedCount: result.modifiedCount ?? 0,
  };
  console.log(
    `[TZ-CATALOG-301] materialKind backfill: matched=${summary.matchedCount}, modified=${summary.modifiedCount}`,
  );
  return summary;
}

/** Self-invocation guard for manual ts-node operation. */
if (require.main === module) {
  (async () => {
    await mongoose.connect(process.env.MONGO_URI ?? 'mongodb://localhost:27017/kppdf');
    try {
      const materialModel = mongoose.model(Material.name, MaterialSchema) as unknown as Model<MaterialDocument>;
      await runTZCatalog301MaterialFieldsMigration(materialModel);
    } finally {
      await mongoose.disconnect();
    }
  })().catch((error: unknown) => {
    console.error('[TZ-CATALOG-301] migration failed', error);
    process.exitCode = 1;
  });
}
