import { BadRequestException, NotFoundException } from '@nestjs/common';
import { UnitService } from './unit.service';

/**
 * TZ-NX-REGISTRY-UNITS-DELETE-FIX regression coverage.
 *
 * `remove()` used to write `deletedAt` via `$set` on a schema with no
 * `deletedAt` prop and `softDelete: false` — Mongoose strict mode silently
 * stripped the field, so the "deleted" unit stayed in Mongo and kept
 * reappearing in `findAll()`/`findByKey()`. The in-memory fake model below
 * mutates on `deleteOne` so these tests prove the unit is actually gone
 * from subsequent reads, not just that `deleteOne` was called.
 */

interface FakeUnit {
  _id: string;
  key: string;
  label: string;
  isActive: boolean;
  isSystem: boolean;
  sortOrder: number;
}

function unitDoc(overrides: Partial<FakeUnit> = {}): FakeUnit {
  return {
    _id: `id-${overrides.key ?? 'kg'}`,
    key: 'kg',
    label: 'Килограмм',
    isActive: true,
    isSystem: false,
    sortOrder: 0,
    ...overrides,
  };
}

function matchesFilter(row: FakeUnit, filter: Record<string, unknown>): boolean {
  return Object.entries(filter).every(
    ([k, v]) => (row as unknown as Record<string, unknown>)[k] === v,
  );
}

function buildModel(seed: FakeUnit[]) {
  const rows: FakeUnit[] = [...seed];

  function query<T>(compute: () => T) {
    return {
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      exec: jest.fn().mockImplementation(async () => compute()),
    };
  }

  const model = {
    find: jest.fn((filter: Record<string, unknown> = {}) =>
      query(() => rows.filter((r) => matchesFilter(r, filter))),
    ),
    findOne: jest.fn((filter: Record<string, unknown> = {}) =>
      query(() => rows.find((r) => matchesFilter(r, filter)) ?? null),
    ),
    countDocuments: jest.fn((filter: Record<string, unknown> = {}) =>
      query(() => rows.filter((r) => matchesFilter(r, filter)).length),
    ),
    create: jest.fn(async (doc: Partial<FakeUnit>) => {
      const created = unitDoc(doc);
      rows.push(created);
      return created;
    }),
    deleteOne: jest.fn((filter: { _id: string }) => ({
      exec: jest.fn().mockImplementation(async () => {
        const idx = rows.findIndex((r) => r._id === filter._id);
        if (idx >= 0) rows.splice(idx, 1);
        return { acknowledged: true, deletedCount: idx >= 0 ? 1 : 0 };
      }),
    })),
  };

  return { model, rows };
}

describe('UnitService.remove (TZ-NX-REGISTRY-UNITS-DELETE-FIX)', () => {
  it('hard-deletes a non-system unit — it disappears from list and lookup, key becomes reusable', async () => {
    const { model } = buildModel([unitDoc({ _id: 'id-kg', key: 'kg' })]);
    const service = new UnitService(model as any);

    await service.remove('kg');

    expect(model.deleteOne).toHaveBeenCalledWith({ _id: 'id-kg' });
    const { items } = await service.findAll();
    expect(items).toHaveLength(0);
    await expect(service.findByKey('kg')).rejects.toBeInstanceOf(NotFoundException);

    // The old soft-delete no-op left the unique `key` index blocking
    // recreation; a real delete must free the key up again.
    await expect(service.create({ key: 'kg', label: 'Килограмм (новый)' })).resolves.toMatchObject({
      key: 'kg',
    });
  });

  it('refuses to delete a system unit and leaves it untouched', async () => {
    const { model } = buildModel([unitDoc({ _id: 'id-pcs', key: 'pcs', isSystem: true })]);
    const service = new UnitService(model as any);

    await expect(service.remove('pcs')).rejects.toBeInstanceOf(BadRequestException);
    expect(model.deleteOne).not.toHaveBeenCalled();

    const doc = await service.findByKey('pcs');
    expect(doc.key).toBe('pcs');
  });

  it('rejects deleting a missing key with NotFoundException and never calls deleteOne', async () => {
    const { model } = buildModel([]);
    const service = new UnitService(model as any);

    await expect(service.remove('ghost')).rejects.toBeInstanceOf(NotFoundException);
    expect(model.deleteOne).not.toHaveBeenCalled();
  });
});
