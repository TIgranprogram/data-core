import type { Connection } from 'mongoose';
import { runTZSales349QuotationIndexHygieneMigration } from './2026-08-09-TZ-SALES-349-quotation-index-hygiene';

function connectionMock(indexes: unknown[]) {
  const collection = {
    indexes: jest.fn().mockResolvedValue(indexes),
    dropIndex: jest.fn().mockResolvedValue(undefined),
  };
  return {
    connection: {
      collection: jest.fn().mockReturnValue(collection),
    } as unknown as Connection,
    collection,
  };
}

describe('TZ-SALES-349 quotation index hygiene migration', () => {
  it('drops only stale unique indexes and retains canonical/helper indexes', async () => {
    const { connection, collection } = connectionMock([
      { name: '_id_', key: { _id: 1 } },
      { name: 'number_1', key: { number: 1 }, unique: true },
      {
        name: 'masterId_1_organizationId_1',
        key: { masterId: 1, organizationId: 1 },
        unique: true,
        sparse: true,
      },
      { name: 'organizationId_1', key: { organizationId: 1 }, unique: true },
      { name: 'status_1_date_-1', key: { status: 1, date: -1 } },
    ]);

    const result =
      await runTZSales349QuotationIndexHygieneMigration(connection);

    expect(collection.dropIndex).toHaveBeenCalledTimes(1);
    expect(collection.dropIndex).toHaveBeenCalledWith('organizationId_1');
    expect(result.dropped).toEqual(['organizationId_1']);
    expect(result.dropFailures).toEqual([]);
  });

  it('is safe on an empty database and a second run', async () => {
    const { connection, collection } = connectionMock([
      { name: '_id_', key: { _id: 1 } },
      { name: 'number_1', key: { number: 1 }, unique: true },
      {
        name: 'masterId_1_organizationId_1',
        key: { masterId: 1, organizationId: 1 },
        unique: true,
        sparse: true,
      },
    ]);

    const first = await runTZSales349QuotationIndexHygieneMigration(connection);
    const second =
      await runTZSales349QuotationIndexHygieneMigration(connection);

    expect(first.dropped).toEqual([]);
    expect(second.dropped).toEqual([]);
    expect(collection.dropIndex).not.toHaveBeenCalled();
  });

  it('treats a missing quotations namespace as an empty database', async () => {
    const { connection, collection } = connectionMock([]);
    collection.indexes.mockRejectedValueOnce(
      Object.assign(new Error('namespace missing'), { code: 26 }),
    );

    await expect(
      runTZSales349QuotationIndexHygieneMigration(connection),
    ).resolves.toEqual({
      inspected: [],
      dropped: [],
      dropFailures: [],
    });
  });

  it('does not fail the migration when an index disappears during cleanup', async () => {
    const { connection, collection } = connectionMock([
      { name: 'legacy_unique_1', key: { legacy: 1 }, unique: true },
    ]);
    collection.dropIndex.mockRejectedValueOnce(new Error('index not found'));

    const result =
      await runTZSales349QuotationIndexHygieneMigration(connection);

    expect(result.dropped).toEqual([]);
    expect(result.dropFailures).toEqual(['legacy_unique_1']);
  });
});
