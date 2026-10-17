import { Types } from 'mongoose';
import { runDedupBlankA4SentinelsMigration } from './2026-09-12-TZ-NX-DOCSTUDIO-TEMPLATES-NO-SENTINEL-SPAM-dedup-sentinels';

function query<T>(value: T) {
  return { sort: jest.fn().mockReturnThis(), exec: jest.fn().mockResolvedValue(value) };
}

function model(rows: Array<{ _id: Types.ObjectId; organizationId: Types.ObjectId }>) {
  return {
    find: jest.fn().mockReturnValue(query(rows)),
    updateMany: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ modifiedCount: rows.length }) }),
  } as any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

describe('TZ-NX-DOCSTUDIO-TEMPLATES-NO-SENTINEL-SPAM dedup sentinels migration', () => {
  it('no sentinels at all: no-op', async () => {
    const templateModel = model([]);
    const result = await runDedupBlankA4SentinelsMigration(templateModel);
    expect(result).toEqual({ organizationsChecked: 0, organizationsWithDuplicates: 0, softDeleted: 0 });
    expect(templateModel.updateMany).not.toHaveBeenCalled();
  });

  it('one sentinel per org: no dedup needed', async () => {
    const orgA = new Types.ObjectId();
    const orgB = new Types.ObjectId();
    const templateModel = model([
      { _id: new Types.ObjectId(), organizationId: orgA },
      { _id: new Types.ObjectId(), organizationId: orgB },
    ]);

    const result = await runDedupBlankA4SentinelsMigration(templateModel);

    expect(result.organizationsChecked).toBe(2);
    expect(result.organizationsWithDuplicates).toBe(0);
    expect(result.softDeleted).toBe(0);
    expect(templateModel.updateMany).not.toHaveBeenCalled();
  });

  it('org with 3 duplicate sentinels: keeps the oldest, soft-deletes the other 2', async () => {
    const org = new Types.ObjectId();
    const oldest = new Types.ObjectId();
    const dup1 = new Types.ObjectId();
    const dup2 = new Types.ObjectId();
    // find(...).sort({ createdAt: 1 }) — mock already returns rows in that order.
    const templateModel = model([
      { _id: oldest, organizationId: org },
      { _id: dup1, organizationId: org },
      { _id: dup2, organizationId: org },
    ]);

    const result = await runDedupBlankA4SentinelsMigration(templateModel);

    expect(result.organizationsChecked).toBe(1);
    expect(result.organizationsWithDuplicates).toBe(1);
    expect(result.softDeleted).toBe(2);
    expect(templateModel.updateMany).toHaveBeenCalledWith(
      { _id: { $in: [dup1, dup2] } },
      { $set: { deletedAt: expect.any(Date) } },
    );
  });

  it('is idempotent — a second run with one sentinel left per org makes no changes', async () => {
    const org = new Types.ObjectId();
    const templateModel = model([{ _id: new Types.ObjectId(), organizationId: org }]);

    const result = await runDedupBlankA4SentinelsMigration(templateModel);

    expect(result.softDeleted).toBe(0);
    expect(templateModel.updateMany).not.toHaveBeenCalled();
  });
});
