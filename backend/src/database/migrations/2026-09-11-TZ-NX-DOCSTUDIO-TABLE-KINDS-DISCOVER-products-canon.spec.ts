import { Types } from 'mongoose';
import { runProductsCanonMigration } from './2026-09-11-TZ-NX-DOCSTUDIO-TABLE-KINDS-DISCOVER-products-canon';

function query<T>(value: T) {
  return { sort: jest.fn().mockReturnThis(), exec: jest.fn().mockResolvedValue(value) };
}

function model(rows: Array<{ _id: Types.ObjectId; columns: Array<{ key: string }> }>) {
  return {
    find: jest.fn().mockReturnValue(query(rows)),
    updateOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ modifiedCount: 1 }) }),
    create: jest.fn().mockImplementation((doc: unknown) => Promise.resolve({ _id: new Types.ObjectId(), ...(doc as object) })),
  } as any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

describe('TZ-NX-DOCSTUDIO-TABLE-KINDS-DISCOVER products canon migration', () => {
  it('creates a fresh canonical template when no active «Продукты» exists', async () => {
    const templateModel = model([]);
    const result = await runProductsCanonMigration(templateModel);
    expect(result.created).toBe(true);
    expect(result.deduped).toBe(0);
    expect(result.addedQtyColumn).toBe(false);
    expect(templateModel.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Продукты', isActive: true }),
    );
  });

  it('deactivates duplicates and adds a qty column to the oldest canonical template', async () => {
    const canonicalId = new Types.ObjectId();
    const dup1 = new Types.ObjectId();
    const dup2 = new Types.ObjectId();
    const columns = [
      { key: 'sku', label: 'Артикул' },
      { key: 'photoIds', label: 'Фото' },
      { key: 'name', label: 'Наименование' },
      { key: 'description', label: 'Описание' },
      { key: 'unit', label: 'Ед.Изм.' },
      { key: 'listPrice', label: 'Цена' },
    ];
    const templateModel = model([
      { _id: canonicalId, columns },
      { _id: dup1, columns },
      { _id: dup2, columns },
    ]);

    const result = await runProductsCanonMigration(templateModel);

    expect(result.created).toBe(false);
    expect(result.canonicalId).toBe(String(canonicalId));
    expect(result.deduped).toBe(2);
    expect(result.addedQtyColumn).toBe(true);
    expect(templateModel.updateOne).toHaveBeenCalledWith({ _id: dup1 }, { $set: { isActive: false } });
    expect(templateModel.updateOne).toHaveBeenCalledWith({ _id: dup2 }, { $set: { isActive: false } });
    expect(templateModel.updateOne).toHaveBeenCalledWith(
      { _id: canonicalId },
      { $set: { columns: [...columns, expect.objectContaining({ key: 'qty' })] } },
    );
  });

  it('is idempotent — a second run with one already-canonical template makes no changes', async () => {
    const canonicalId = new Types.ObjectId();
    const columns = [
      { key: 'sku', label: 'Артикул' },
      { key: 'qty', label: 'Количество' },
    ];
    const templateModel = model([{ _id: canonicalId, columns }]);

    const result = await runProductsCanonMigration(templateModel);

    expect(result.created).toBe(false);
    expect(result.deduped).toBe(0);
    expect(result.addedQtyColumn).toBe(false);
    expect(templateModel.updateOne).not.toHaveBeenCalled();
  });

  it('recognizes a qty column under any alias, not just the canonical key', async () => {
    const canonicalId = new Types.ObjectId();
    const columns = [
      { key: 'name', label: 'Наименование' },
      { key: 'Количество', label: 'Кол-во' },
    ];
    const templateModel = model([{ _id: canonicalId, columns }]);

    const result = await runProductsCanonMigration(templateModel);

    expect(result.addedQtyColumn).toBe(false);
    expect(templateModel.updateOne).not.toHaveBeenCalled();
  });
});
