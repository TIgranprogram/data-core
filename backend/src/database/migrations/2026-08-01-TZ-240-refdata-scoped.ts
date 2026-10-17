import { Model, Types } from 'mongoose';
import { Product } from '../../modules/product/product.schema';
import { Material } from '../../modules/material/material.schema';
import { Category } from '../../modules/category/category.schema';
import { Organization } from '../../modules/organization/organization.schema';

/**
 * TZ-240 — Reference data scoping migration.
 *
 * Goal: assign every existing Product / Material / Category missing an
 * organizationId to the **first** organization in the database (the
 * bootstrap default). System records (isSystem === true) are left untouched
 * — they are global by design.
 *
 * Idempotency: re-running this after a successful run is safe because the
 * `$or` query only matches documents where organizationId is missing. No
 * `updateMany` will fire on already-migrated documents.
 *
 * SAFETY:
 *   - Migration side-effects are bounded to document-level field writes.
 *   - Logs the modified count for ops audit.
 *   - Requires at least ONE Organization to exist; otherwise no-ops with a
 *     log line so the operator sees the issue instead of silently losing
 *     ref-data isolation.
 *
 * RUNTIME INVOCATION (manual):
 *   - `npx ts-node backend/src/database/migrations/2026-08-01-TZ-240-refdata-scoped.ts`
 *     OR via `npm run migrate:tz-240` once a runner script exists.
 */
export async function runTZ240Migration(
  productModel: Model<Product>,
  materialModel: Model<Material>,
  categoryModel: Model<Category>,
  orgModel: Model<Organization>,
): Promise<void> {
  const orgs = await orgModel.find().limit(1).exec();
  if (orgs.length === 0) {
    console.log(
      '[TZ-240] No organizations found in DB. Skipping migration. ' +
        'To enable ref-data scoping, create at least one organization first.',
    );
    return;
  }
  const defaultOrgId = new Types.ObjectId(orgs[0].id);

  const filter = {
    organizationId: { $exists: false },
    isSystem: { $ne: true },
  };

  const products = await productModel
    .updateMany(filter, { $set: { organizationId: defaultOrgId } })
    .exec();
  const materials = await materialModel
    .updateMany(filter, { $set: { organizationId: defaultOrgId } })
    .exec();
  const categories = await categoryModel
    .updateMany(filter, { $set: { organizationId: defaultOrgId } })
    .exec();

  console.log(
    `[TZ-240] Migrated ${products.modifiedCount} products, ` +
      `${materials.modifiedCount} materials, ` +
      `${categories.modifiedCount} categories → default org ${orgs[0].id}`,
  );
}
