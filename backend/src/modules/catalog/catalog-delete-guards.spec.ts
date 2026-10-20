import { ConflictException } from '@nestjs/common';
import { Types } from 'mongoose';
import { MaterialService } from '../material/material.service';
import { ProductService } from '../product/product.service';
import { ProductModuleService } from '../product-module/product-module.service';
import { WorkTypeService } from '../work-type/work-type.service';

/**
 * Защита удаления справочников: действующий каталог (products / productmodules)
 * + таблицы CRM kppdf, который с 2026-10-18 работает на той же базе.
 */

/** Фейковый `model.db`: `hits` — коллекции, где findOne «находит» ссылку. */
function fakeDb(hits: string[] = []) {
  const calls: { name: string; filter: Record<string, unknown> }[] = [];
  const db = {
    collection: jest.fn((name: string) => ({
      findOne: jest.fn(async (filter: Record<string, unknown>) => {
        calls.push({ name, filter });
        return hits.includes(name) ? { _id: new Types.ObjectId() } : null;
      }),
    })),
  };
  return { db, calls };
}

function chain<T>(value: T) {
  const q: Record<string, unknown> = {};
  q.populate = jest.fn(() => q);
  q.exec = jest.fn(async () => value);
  return q;
}

function modelWith(doc: Record<string, unknown>, hits: string[] = []) {
  const { db, calls } = fakeDb(hits);
  const model = {
    db,
    findById: jest.fn(() => chain(doc)),
    findOne: jest.fn(() => chain(doc)),
    updateOne: jest.fn(() => ({ exec: jest.fn(async () => ({ modifiedCount: 1 })) })),
  };
  return { model, calls };
}

type Remover = (model: unknown) => { remove: (id: string) => Promise<void> };

const cases: { title: string; make: Remover; owners: string[]; crm: string[] }[] = [
  {
    title: 'MaterialService',
    make: (m) => new MaterialService(m as never, {} as never, {} as never, {} as never, undefined),
    owners: ['products', 'productmodules'],
    crm: ['costcalculations', 'purchaseorders'],
  },
  {
    title: 'ProductService',
    make: (m) => new ProductService(m as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never),
    owners: ['products', 'productmodules'],
    crm: ['orders', 'quotations', 'costcalculations', 'boms'],
  },
  {
    title: 'ProductModuleService',
    make: (m) => new ProductModuleService(m as never, {} as never, {} as never, {} as never, undefined, {} as never),
    owners: ['products', 'productmodules'],
    crm: ['boms'],
  },
  {
    title: 'WorkTypeService',
    make: (m) => new WorkTypeService(m as never),
    owners: ['productmodules'],
    crm: ['costcalculations', 'workers'],
  },
];

describe.each(cases)('$title.remove — защита удаления', ({ make, owners, crm }) => {
  const id = new Types.ObjectId();
  const doc = () => ({ _id: id, deletedAt: null });

  it('архивирует запись без ссылок, проверив каталог и CRM', async () => {
    const { model, calls } = modelWith(doc());
    await make(model).remove(id.toString());
    expect(model.updateOne).toHaveBeenCalledTimes(1);
    expect(calls.map((c) => c.name).sort()).toEqual([...owners, ...crm].sort());
  });

  it.each([...owners, ...crm])('409, если запись используется в %s', async (owner) => {
    const { model } = modelWith(doc(), [owner]);
    await expect(make(model).remove(id.toString())).rejects.toBeInstanceOf(ConflictException);
    expect(model.updateOne).not.toHaveBeenCalled();
  });
});

describe('фильтры поиска ссылок в составе', () => {
  it('материал: composition.$elemMatch по lineType=material + старое поле materials.materialId', async () => {
    const id = new Types.ObjectId();
    const { model, calls } = modelWith({ _id: id, deletedAt: null });
    await cases[0].make(model).remove(id.toString());
    const pm = calls.find((c) => c.name === 'productmodules')!.filter;
    expect(pm).toEqual({ $or: [{ composition: { $elemMatch: { lineType: 'material', refId: id } } }, { 'materials.materialId': id }] });
    const pr = calls.find((c) => c.name === 'products')!.filter;
    expect(pr).toEqual({ $or: [{ composition: { $elemMatch: { lineType: 'material', refId: id } } }] });
  });

  it('модуль: products учитывает старое поле productModuleIds', async () => {
    const id = new Types.ObjectId();
    const { model, calls } = modelWith({ _id: id, deletedAt: null });
    await cases[2].make(model).remove(id.toString());
    expect(calls.find((c) => c.name === 'products')!.filter).toEqual({
      $or: [{ composition: { $elemMatch: { lineType: 'module', refId: id } } }, { productModuleIds: id }],
    });
    expect(calls.find((c) => c.name === 'productmodules')!.filter).toEqual({
      $or: [{ composition: { $elemMatch: { lineType: 'module', refId: id } } }],
    });
  });

  it('вид работ: productmodules.workTypes.workTypeId', async () => {
    const id = new Types.ObjectId();
    const { model, calls } = modelWith({ _id: id, deletedAt: null });
    await cases[3].make(model).remove(id.toString());
    expect(calls[0]).toEqual({ name: 'productmodules', filter: { 'workTypes.workTypeId': id } });
    expect(calls.slice(1)).toEqual([
      { name: 'costcalculations', filter: { 'labor.workTypeId': id } },
      { name: 'workers', filter: { workTypeIds: id } },
    ]);
  });
});
