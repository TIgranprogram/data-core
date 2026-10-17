import type { Model } from 'mongoose';
import { runTZCatalog301MaterialFieldsMigration } from './2026-08-04-TZ-CATALOG-301-material-fields';
import type { MaterialDocument } from '../../modules/material/material.schema';

describe('TZ-CATALOG-301 material fields migration', () => {
  it('backfills only missing or null materialKind values to other', async () => {
    const updateMany = jest.fn().mockResolvedValue({ matchedCount: 3, modifiedCount: 3 });
    const model = { collection: { updateMany } } as unknown as Model<MaterialDocument>;

    await expect(runTZCatalog301MaterialFieldsMigration(model)).resolves.toEqual({
      matchedCount: 3,
      modifiedCount: 3,
    });

    expect(updateMany).toHaveBeenCalledWith(
      {
        $or: [{ materialKind: { $exists: false } }, { materialKind: null }],
      },
      { $set: { materialKind: 'other' } },
    );
  });

  it('is a no-op when no legacy rows remain on a repeat run', async () => {
    const updateMany = jest.fn().mockResolvedValue({ matchedCount: 0, modifiedCount: 0 });
    const model = { collection: { updateMany } } as unknown as Model<MaterialDocument>;

    await expect(runTZCatalog301MaterialFieldsMigration(model)).resolves.toEqual({
      matchedCount: 0,
      modifiedCount: 0,
    });
  });
});
