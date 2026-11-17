import { Types } from 'mongoose';
import { FakeDb } from '../control/questions/fake-db.testkit';
import { missingSupplierLine, purchasedMaterialsOfOrder, supplierEntryNames, supplierFilesOf } from './purchased-of-order';

const id = () => new Types.ObjectId();

function world() {
  const db = new FakeDb();
  const order = id();
  const [p1, p2, mod, boltM, valveM, gripM, sheetM] = [id(), id(), id(), id(), id(), id(), id()];
  const put = (n: string, ...rows: Array<Record<string, unknown>>) => { db.collection(n).rows.push(...rows); };
  put('materials',
    { _id: valveM, name: 'Кран шаровой', materialKind: 'purchased', deletedAt: null },
    { _id: gripM, name: 'Ручка', materialKind: 'purchased', deletedAt: null },
    { _id: boltM, name: 'Болт', materialKind: 'fastener', deletedAt: null },
    { _id: sheetM, name: 'Лист', materialKind: 'raw', deletedAt: null });
  // кран — и в изделии 1, и во вложенном модуле изделия 2 (должен быть один раз)
  put('products',
    { _id: p1, composition: [{ lineType: 'material', refId: valveM }, { lineType: 'material', refId: boltM }] },
    { _id: p2, composition: [{ lineType: 'module', refId: mod }, { lineType: 'material', refId: sheetM }] });
  put('productmodules', { _id: mod, composition: [{ lineType: 'material', refId: valveM }], materials: [{ materialId: gripM }] });
  put('incomes',
    { _id: id(), orderId: order, productId: p1, deletedAt: null, cancelledAt: null },
    { _id: id(), orderId: order, productId: p2, deletedAt: null, cancelledAt: null },
    { _id: id(), orderId: order, productId: null, deletedAt: null, cancelledAt: null });
  return { db, order, valveM, gripM };
}

describe('покупное в заказе (C136)', () => {
  it('материал в двух изделиях — одна запись; только purchased; старый состав модуля учтён', async () => {
    const w = world();
    const r = await purchasedMaterialsOfOrder(w.db as never, String(w.order));
    expect(r.map((x) => x.name).sort()).toEqual(['Кран шаровой', 'Ручка']);
    expect(r.filter((x) => x.id === String(w.valveM))).toHaveLength(1);
  });

  it('чужой или кривой заказ — пусто', async () => {
    const w = world();
    expect(await purchasedMaterialsOfOrder(w.db as never, String(id()))).toEqual([]);
    expect(await purchasedMaterialsOfOrder(w.db as never, 'x')).toEqual([]);
  });

  it('файл поставщика: берётся последний живой, убранный не считается', async () => {
    const w = world();
    const mats = await purchasedMaterialsOfOrder(w.db as never, String(w.order));
    w.db.collection('productattachments').rows.push(
      { _id: id(), materialId: w.valveM, storedPath: 'attachments/a/old.pdf', ext: 'pdf', uploadedAt: new Date('2026-11-01'), deletedAt: null },
      { _id: id(), materialId: w.valveM, storedPath: 'attachments/a/new.pdf', ext: 'pdf', uploadedAt: new Date('2026-11-10'), deletedAt: null },
      { _id: id(), materialId: w.gripM, storedPath: 'attachments/a/g.pdf', ext: 'pdf', uploadedAt: new Date('2026-11-12'), deletedAt: new Date() });
    const files = await supplierFilesOf(w.db as never, mats);
    expect(files.get(String(w.valveM))?.path).toBe('attachments/a/new.pdf');
    expect(files.has(String(w.gripM))).toBe(false); // нет файла → строка «нет паспорта поставщика»
    expect(missingSupplierLine('Ручка')).toBe('нет паспорта поставщика: Ручка');
  });

  it('имена в архиве: Поставщик_<материал>.<ext>, совпадение — суффикс', () => {
    expect(supplierEntryNames([{ name: 'Кран', ext: 'pdf' }, { name: 'Кран', ext: 'pdf' }, { name: 'А/Б', ext: 'jpg' }])).toEqual(['Поставщик_Кран.pdf', 'Поставщик_Кран_2.pdf', 'Поставщик_А_Б.jpg']);
  });
});
