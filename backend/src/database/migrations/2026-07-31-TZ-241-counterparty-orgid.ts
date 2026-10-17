import { Model, Types } from 'mongoose';
import { Counterparty } from '../../modules/counterparty/counterparty.schema';
import { Organization } from '../../modules/organization/organization.schema';

/**
 * TZ-241 — Counterparty org-scoping migration.
 *
 * Goal: assign every existing Counterparty missing an organizationId
 * to the first organization in the database (the bootstrap default).
 * System records (isSystem === true) are left untouched.
 *
 * Idempotency: re-running this after a successful run is safe because
 * the `$or` query only matches documents where organizationId is missing.
 * No `updateMany` will fire on already-migrated documents.
 *
 * SAFETY:
 *   - Migration side-effects are bounded to document-level field writes.
 *   - Logs the modified count for ops audit.
 *   - Requires at least ONE Organization to exist; otherwise no-ops with a
 *     log line so the operator sees the issue instead of silently losing
 *     counterparty isolation.
 */
export async function runTZ241Migration(
  counterpartyModel: Model<Counterparty>,
  orgModel: Model<Organization>,
): Promise<void> {
  const orgs = await orgModel.find().limit(1).exec();
  if (orgs.length === 0) {
    console.log(
      '[TZ-241] No organizations found in DB. Skipping migration. ' +
        'To enable counterparty org-scoping, create at least one organization first.',
    );
    return;
  }
  const defaultOrgId = new Types.ObjectId(orgs[0].id);

  const filter = {
    organizationId: { $exists: false },
    isSystem: { $ne: true },
  };

  const result = await counterpartyModel
    .updateMany(filter, { $set: { organizationId: defaultOrgId } })
    .exec();

  console.log(
    `[TZ-241] Migrated ${result.modifiedCount} counterparties → default org ${orgs[0].id}`,
  );
}