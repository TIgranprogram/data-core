import type { Model } from 'mongoose';
import { Counterparty, type CounterpartyDocument } from '../../modules/counterparty/counterparty.schema';
import { Organization, type OrganizationDocument } from '../../modules/organization/organization.schema';

export interface TZParty301InnCollision {
  organizationId: string | null;
  inn: string;
  count: number;
}

export interface TZParty301MigrationResult {
  droppedGlobalInnIndex: boolean;
  innStubBackfilled: number;
  ourCompanyMarked: string | null;
  collisions: TZParty301InnCollision[];
}

/** Mongo's default name for the legacy `{ inn: 1 }` unique index. */
const GLOBAL_INN_INDEX = 'inn_1';

/**
 * TZ-PARTY-301 — party hygiene.
 *
 * 1. Drops the global unique index on `counterparties.inn`. It made INN a
 *    first-come-first-served resource across tenants: once tenant A saved
 *    «ООО Ромашка», tenant B could not add the same real company at all.
 *    Per-tenant uniqueness stays enforced by the compound
 *    `{ organizationId, inn }` sparse unique index declared on the schema.
 * 2. Reports remaining `{organizationId, inn}` duplicates instead of failing:
 *    the compound index is created by Mongoose autoIndex and would silently
 *    stay absent on a dirty collection, so the operator needs the list.
 * 3. Backfills `innIsStub: false` for rows that predate the flag, so the UI
 *    badge means «quick-created», not «field missing».
 * 4. Marks a single organization as «наша фирма» when nothing is marked yet,
 *    so `GET /organizations/current` resolves right after the upgrade.
 *
 * Idempotency: every step is a no-op on a second run (index already gone,
 * no rows missing the flag, a company already marked).
 */
export async function runTZParty301PartyHygieneMigration(
  counterpartyModel: Model<CounterpartyDocument>,
  organizationModel: Model<OrganizationDocument>,
): Promise<TZParty301MigrationResult> {
  const droppedGlobalInnIndex = await dropGlobalInnIndex(counterpartyModel);
  const collisions = await findInnCollisions(counterpartyModel);

  const stubBackfill = await counterpartyModel.collection.updateMany(
    { innIsStub: { $exists: false } },
    { $set: { innIsStub: false } },
  );

  const ourCompanyMarked = await markOurCompany(organizationModel);

  const summary: TZParty301MigrationResult = {
    droppedGlobalInnIndex,
    innStubBackfilled: stubBackfill.modifiedCount ?? 0,
    ourCompanyMarked,
    collisions,
  };

  console.log(
    `[TZ-PARTY-301] global inn index dropped=${summary.droppedGlobalInnIndex}, ` +
      `innIsStub backfilled=${summary.innStubBackfilled}, ` +
      `our company=${summary.ourCompanyMarked ?? 'unchanged'}, ` +
      `org+inn collisions=${summary.collisions.length}`,
  );
  for (const collision of summary.collisions) {
    console.warn(
      `[TZ-PARTY-301] duplicate inn ${collision.inn} × ${collision.count} ` +
        `in org ${collision.organizationId ?? 'none'} — merge or clear before the ` +
        'compound unique index can be built',
    );
  }
  return summary;
}

async function dropGlobalInnIndex(model: Model<CounterpartyDocument>): Promise<boolean> {
  const indexes = (await model.collection.indexes()) as { name?: string; key?: Record<string, unknown> }[];
  const legacy = indexes.find(
    (index) => index.name === GLOBAL_INN_INDEX || (index.key && Object.keys(index.key).join(',') === 'inn'),
  );
  if (!legacy?.name) return false;
  await model.collection.dropIndex(legacy.name);
  return true;
}

async function findInnCollisions(
  model: Model<CounterpartyDocument>,
): Promise<TZParty301InnCollision[]> {
  const rows = await model.collection
    .aggregate<{ _id: { organizationId: unknown; inn: string }; count: number }>([
      { $match: { deletedAt: null } },
      { $group: { _id: { organizationId: '$organizationId', inn: '$inn' }, count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } },
      { $sort: { count: -1 } },
    ])
    .toArray();

  return rows.map((row) => ({
    organizationId: row._id.organizationId ? String(row._id.organizationId) : null,
    inn: row._id.inn,
    count: row.count,
  }));
}

async function markOurCompany(model: Model<OrganizationDocument>): Promise<string | null> {
  const alreadyMarked = await model.collection.findOne({ isOurCompany: true, deletedAt: null });
  if (alreadyMarked) return null;

  const candidates = await model.collection
    .find({ $or: [{ deletedAt: null }, { deletedAt: { $exists: false } }] })
    .limit(2)
    .toArray();
  if (candidates.length !== 1) return null;

  const only = candidates[0]!;
  await model.collection.updateOne({ _id: only._id }, { $set: { isOurCompany: true } });
  return String(only._id);
}

/** Self-invocation guard for manual ts-node operation. */
if (require.main === module) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mongoose = require('mongoose');
  (async () => {
    await mongoose.connect(process.env.MONGO_URI ?? 'mongodb://localhost:27017/kppdf');
    try {
      const counterpartyModel = mongoose.model(
        Counterparty.name,
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        require('../../modules/counterparty/counterparty.schema').CounterpartySchema,
      );
      const organizationModel = mongoose.model(
        Organization.name,
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        require('../../modules/organization/organization.schema').OrganizationSchema,
      );
      await runTZParty301PartyHygieneMigration(counterpartyModel, organizationModel);
    } finally {
      await mongoose.disconnect();
    }
  })().catch((error: unknown) => {
    console.error('[TZ-PARTY-301] migration failed', error);
    process.exitCode = 1;
  });
}
