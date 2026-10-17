import type { Model } from 'mongoose';
import { runTZParty301PartyHygieneMigration } from './2026-08-08-TZ-PARTY-301-party-hygiene';
import type { CounterpartyDocument } from '../../modules/counterparty/counterparty.schema';
import type { OrganizationDocument } from '../../modules/organization/organization.schema';

interface CounterpartyCollectionMock {
  indexes: jest.Mock;
  dropIndex: jest.Mock;
  updateMany: jest.Mock;
  aggregate: jest.Mock;
}

interface OrganizationCollectionMock {
  findOne: jest.Mock;
  find: jest.Mock;
  updateOne: jest.Mock;
}

function counterpartyModel(
  overrides: Partial<CounterpartyCollectionMock> = {},
): { model: Model<CounterpartyDocument>; collection: CounterpartyCollectionMock } {
  const collection: CounterpartyCollectionMock = {
    indexes: jest.fn().mockResolvedValue([{ name: '_id_', key: { _id: 1 } }]),
    dropIndex: jest.fn().mockResolvedValue(undefined),
    updateMany: jest.fn().mockResolvedValue({ matchedCount: 0, modifiedCount: 0 }),
    aggregate: jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) }),
    ...overrides,
  };
  return { model: { collection } as unknown as Model<CounterpartyDocument>, collection };
}

function organizationModel(
  overrides: Partial<OrganizationCollectionMock> = {},
): { model: Model<OrganizationDocument>; collection: OrganizationCollectionMock } {
  const collection: OrganizationCollectionMock = {
    findOne: jest.fn().mockResolvedValue({ _id: 'already-ours' }),
    find: jest.fn().mockReturnValue({
      limit: jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) }),
    }),
    updateOne: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  return { model: { collection } as unknown as Model<OrganizationDocument>, collection };
}

describe('TZ-PARTY-301 party hygiene migration', () => {
  it('drops the legacy global unique index on inn', async () => {
    const cp = counterpartyModel({
      indexes: jest.fn().mockResolvedValue([
        { name: '_id_', key: { _id: 1 } },
        { name: 'inn_1', key: { inn: 1 } },
      ]),
    });
    const org = organizationModel();

    const result = await runTZParty301PartyHygieneMigration(cp.model, org.model);

    expect(cp.collection.dropIndex).toHaveBeenCalledWith('inn_1');
    expect(result.droppedGlobalInnIndex).toBe(true);
  });

  it('is a no-op on a second run when the global index is already gone', async () => {
    const cp = counterpartyModel();
    const org = organizationModel();

    const result = await runTZParty301PartyHygieneMigration(cp.model, org.model);

    expect(cp.collection.dropIndex).not.toHaveBeenCalled();
    expect(result).toEqual({
      droppedGlobalInnIndex: false,
      innStubBackfilled: 0,
      ourCompanyMarked: null,
      collisions: [],
    });
  });

  it('backfills innIsStub only where the flag is missing', async () => {
    const cp = counterpartyModel({
      updateMany: jest.fn().mockResolvedValue({ matchedCount: 4, modifiedCount: 4 }),
    });
    const org = organizationModel();

    const result = await runTZParty301PartyHygieneMigration(cp.model, org.model);

    expect(cp.collection.updateMany).toHaveBeenCalledWith(
      { innIsStub: { $exists: false } },
      { $set: { innIsStub: false } },
    );
    expect(result.innStubBackfilled).toBe(4);
  });

  it('reports per-tenant inn collisions instead of throwing', async () => {
    const cp = counterpartyModel({
      aggregate: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue([
          { _id: { organizationId: 'org-1', inn: '7701234567' }, count: 3 },
          { _id: { organizationId: null, inn: '7809876543' }, count: 2 },
        ]),
      }),
    });
    const org = organizationModel();

    const result = await runTZParty301PartyHygieneMigration(cp.model, org.model);

    expect(result.collisions).toEqual([
      { organizationId: 'org-1', inn: '7701234567', count: 3 },
      { organizationId: null, inn: '7809876543', count: 2 },
    ]);
  });

  it('marks the only organization as our company when none is marked', async () => {
    const cp = counterpartyModel();
    const org = organizationModel({
      findOne: jest.fn().mockResolvedValue(null),
      find: jest.fn().mockReturnValue({
        limit: jest.fn().mockReturnValue({
          toArray: jest.fn().mockResolvedValue([{ _id: 'org-1' }]),
        }),
      }),
    });

    const result = await runTZParty301PartyHygieneMigration(cp.model, org.model);

    expect(org.collection.updateOne).toHaveBeenCalledWith(
      { _id: 'org-1' },
      { $set: { isOurCompany: true } },
    );
    expect(result.ourCompanyMarked).toBe('org-1');
  });

  it('leaves the choice to the operator when several organizations exist', async () => {
    const cp = counterpartyModel();
    const org = organizationModel({
      findOne: jest.fn().mockResolvedValue(null),
      find: jest.fn().mockReturnValue({
        limit: jest.fn().mockReturnValue({
          toArray: jest.fn().mockResolvedValue([{ _id: 'org-1' }, { _id: 'org-2' }]),
        }),
      }),
    });

    const result = await runTZParty301PartyHygieneMigration(cp.model, org.model);

    expect(org.collection.updateOne).not.toHaveBeenCalled();
    expect(result.ourCompanyMarked).toBeNull();
  });
});
