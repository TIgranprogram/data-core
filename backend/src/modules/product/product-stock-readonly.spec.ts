import { Types } from 'mongoose';
import { ProductService } from './product.service';
import { CompositionLineService } from '../../common/catalog/composition-line.service';
import { SupplierCatalogService } from '../supply/supplier-catalog.service';

/** ДМ.5: остаток — только storageitems; stockQty из запросов игнорируется, копия переносит модули в composition. */
function svc(model: Record<string, unknown>, lines: unknown = {}) {
  return new ProductService(model as never, {} as never, {} as never, {} as never, {} as never, { loadAttributes: jest.fn().mockResolvedValue({}), resolveAttributes: jest.fn() } as never, lines as never, {} as never);
}

describe('ДМ.5 — stockQty только для чтения', () => {
  it('update не пишет stockQty', async () => {
    const id = new Types.ObjectId();
    const model = {
      findOne: jest.fn(() => ({ exec: jest.fn().mockResolvedValue({ _id: id, __v: 1 }) })),
      findOneAndUpdate: jest.fn(() => ({ exec: jest.fn().mockResolvedValue({ _id: id, __v: 2 }) })),
    };
    await svc(model).update(id.toString(), { stockQty: 99, notes: 'x' } as never);
    const [, upd] = (model.findOneAndUpdate as jest.Mock).mock.calls[0];
    expect(upd.$set).not.toHaveProperty('stockQty');
    expect(upd.$set.notes).toBe('x');
  });

  it('create пишет stockQty: 0 независимо от запроса', async () => {
    const model = { create: jest.fn().mockResolvedValue({ _id: new Types.ObjectId() }) };
    await svc(model).create({ sku: 'A-1', name: 'x', stockQty: 50 } as never);
    expect((model.create as jest.Mock).mock.calls[0][0].stockQty).toBe(0);
  });

  it('копия: productModuleIds пуст, модули в composition', async () => {
    const sourceId = new Types.ObjectId();
    const modId = new Types.ObjectId();
    const source = { _id: sourceId, name: 'Стол', sku: 'T-1', kind: 'good', unit: 'шт', photoIds: [], productModuleIds: [modId], composition: [] };
    const model = {
      findOne: jest.fn(() => ({ exec: jest.fn().mockResolvedValue(source) })),
      find: jest.fn(() => ({ select: jest.fn(() => ({ lean: jest.fn(() => ({ exec: jest.fn().mockResolvedValue([]) })) })) })),
      create: jest.fn().mockResolvedValue({ _id: new Types.ObjectId() }),
    };
    await svc(model).duplicate(sourceId.toString());
    const p = (model.create as jest.Mock).mock.calls[0][0];
    expect(p.productModuleIds).toEqual([]);
    expect(p.composition).toHaveLength(1);
    expect(p.composition[0]).toMatchObject({ lineType: 'module', quantity: 1 });
    expect(String(p.composition[0].refId)).toBe(String(modId));
  });

  it('dualRead отдаёт composition, если он не пуст', () => {
    const comp = [{ lineType: 'material', refId: new Types.ObjectId(), quantity: 1, sortOrder: 0 }];
    const legacy = [{ lineType: 'module', refId: new Types.ObjectId(), quantity: 1, sortOrder: 0 }];
    const s = new CompositionLineService();
    expect(s.dualRead({ composition: comp } as never, legacy as never)).toEqual(comp);
    expect(s.dualRead({ composition: [] } as never, legacy as never)).toEqual(legacy);
  });
});

describe('ДМ.5 — каталог поставщиков берёт остаток из storageitems', () => {
  it('сумма storageitems приоритетнее materials.stockQty; без записей — запасной', async () => {
    const m1 = new Types.ObjectId(), m2 = new Types.ObjectId();
    const data: Record<string, unknown[]> = {
      organizations: [],
      materials: [{ _id: m1, name: 'A', stockQty: 5 }, { _id: m2, name: 'B', stockQty: 7 }],
      storageitems: [{ _id: m1, qty: 12 }],
      files: [],
    };
    const coll = (n: string) => ({
      find: () => ({ toArray: async () => data[n] ?? [] }),
      aggregate: () => ({ toArray: async () => data[n] ?? [] }),
    });
    const service = new SupplierCatalogService({ db: { collection: coll } } as never);
    const rows = await (service as any).present([
      { _id: new Types.ObjectId(), supplierId: new Types.ObjectId(), materialId: m1 },
      { _id: new Types.ObjectId(), supplierId: new Types.ObjectId(), materialId: m2 },
    ]);
    expect(rows[0].stockQty).toBe(12);
    expect(rows[1].stockQty).toBe(7);
  });
});
