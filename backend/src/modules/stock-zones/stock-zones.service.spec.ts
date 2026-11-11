import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { setStockZones, setCategoryTree } from '../../common/stock-scope';
import { StockZonesService } from './stock-zones.service';

type Zone = {
  _id: Types.ObjectId;
  name: string;
  categoryIds?: Types.ObjectId[];
  includeMaterialIds?: Types.ObjectId[];
  excludeMaterialIds?: Types.ObjectId[];
  isDefault?: boolean;
  order?: number;
  deletedAt?: Date | null;
};

const chain = (result: unknown) => {
  const c: Record<string, jest.Mock> = {};
  for (const m of ['sort', 'lean']) c[m] = jest.fn(() => c);
  c.exec = jest.fn(async () => result);
  return c;
};

function make(initial: Zone[] = []) {
  const zones = [...initial];
  const counts: Record<string, number> = { categories: 0, materials: 0, roles: 0 };
  const coll = (name: string) => ({
    find: jest.fn(() => ({ toArray: async () => [] })),
    countDocuments: jest.fn(async () => counts[name] ?? 0),
  });
  const connection = { db: { collection: jest.fn((n: string) => coll(n)) } };
  const model = {
    find: jest.fn((f: Record<string, unknown>) =>
      chain(zones.filter((z) => (f.deletedAt === null ? z.deletedAt == null : true))),
    ),
    findOne: jest.fn((f: Record<string, unknown>) => {
      const hit = zones.find((z) => {
        if (f.deletedAt === null && z.deletedAt != null) return false;
        if (f.name instanceof RegExp && !f.name.test(z.name)) return false;
        if (f._id instanceof Types.ObjectId || typeof f._id === 'string') {
          if (String(z._id) !== String(f._id)) return false;
        }
        const ne = (f._id as { $ne?: string | Types.ObjectId } | undefined)?.$ne;
        if (ne && String(z._id) === String(ne)) return false;
        return true;
      });
      return chain(hit ?? null);
    }),
    create: jest.fn(async (row: Record<string, unknown>) => {
      const doc = { _id: new Types.ObjectId(), deletedAt: null, ...row } as Zone;
      zones.push(doc);
      return doc;
    }),
    updateOne: jest.fn(async (f: { _id: string }, u: { $set: Record<string, unknown> }) => {
      const z = zones.find((x) => String(x._id) === String(f._id));
      if (z) Object.assign(z, u.$set);
      return { matchedCount: z ? 1 : 0 };
    }),
    updateMany: jest.fn(async () => {
      for (const z of zones) {
        if (z.isDefault) z.isDefault = false;
      }
      return { modifiedCount: 1 };
    }),
  };
  const service = new StockZonesService(model as never, connection as never);
  // refresh трогает кэш — обнуляем перед тестами
  setStockZones([]);
  setCategoryTree([]);
  return { service, model, zones, counts, connection };
}

describe('StockZonesService', () => {
  it('get: невалидный id → 400', async () => {
    const { service } = make();
    await expect(service.get('bad')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('get: нет склада → 404', async () => {
    const { service } = make();
    await expect(service.get(String(new Types.ObjectId()))).rejects.toBeInstanceOf(NotFoundException);
  });

  it('create: дубль имени → 409', async () => {
    const id = new Types.ObjectId();
    const { service } = make([{ _id: id, name: 'Основной', deletedAt: null }]);
    await expect(service.create({ name: 'основной' })).rejects.toBeInstanceOf(ConflictException);
  });

  it('create: позиция и в добавках, и в исключениях → 400', async () => {
    const mid = String(new Types.ObjectId());
    const { service, counts } = make();
    counts.materials = 1;
    await expect(
      service.create({ name: 'Цех', includeMaterialIds: [mid], excludeMaterialIds: [mid] }),
    ).rejects.toThrow(/добавках/);
  });

  it('create пишет склад и возвращает present', async () => {
    const { service, model } = make();
    const res = await service.create({ name: '  Цех А  ', order: 10 });
    expect(model.create).toHaveBeenCalled();
    expect(res.name).toBe('Цех А');
    expect(res.order).toBe(10);
    expect(res.isDefault).toBe(false);
  });

  it('update: снять isDefault с единственного основного → 400', async () => {
    const id = new Types.ObjectId();
    const { service } = make([{ _id: id, name: 'Основной', isDefault: true, deletedAt: null }]);
    await expect(service.update(String(id), { isDefault: false })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('remove: основной склад → 409', async () => {
    const id = new Types.ObjectId();
    const { service } = make([{ _id: id, name: 'Основной', isDefault: true, deletedAt: null }]);
    await expect(service.remove(String(id))).rejects.toBeInstanceOf(ConflictException);
  });

  it('remove: склад в ролях → 409', async () => {
    const id = new Types.ObjectId();
    const { service, counts } = make([{ _id: id, name: 'Цех', isDefault: false, deletedAt: null }]);
    counts.roles = 2;
    await expect(service.remove(String(id))).rejects.toThrow(/ролях/);
  });

  it('list возвращает все живые склады', async () => {
    const a = new Types.ObjectId();
    const b = new Types.ObjectId();
    const { service } = make([
      { _id: a, name: 'A', deletedAt: null, order: 1 },
      { _id: b, name: 'B', deletedAt: new Date(), order: 2 },
    ]);
    const res = await service.list();
    expect(res.total).toBe(1);
    expect(res.items[0].name).toBe('A');
  });
});
