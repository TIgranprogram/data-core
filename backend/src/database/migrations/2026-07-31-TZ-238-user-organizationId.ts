import { Model, Types } from 'mongoose';
import { User } from '../../modules/user/user.schema';
import { Organization } from '../../modules/organization/organization.schema';

export async function runTZ238Migration(
  userModel: Model<User>,
  orgModel: Model<Organization>,
): Promise<void> {
  const orgs = await orgModel.find().limit(1).exec();
  if (orgs.length === 0) {
    console.log('[TZ-238] No organizations found; nothing to migrate');
    return;
  }
  const defaultOrgId = orgs[0].id;
  const result = await userModel
    .updateMany(
      { organizationId: { $exists: false } },
      { $set: { organizationId: new Types.ObjectId(defaultOrgId) } },
    )
    .exec();
  console.log(`[TZ-238] Migrated ${result.modifiedCount} users to org ${defaultOrgId}`);
}
