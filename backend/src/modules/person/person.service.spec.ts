import { NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { PersonService } from './person.service';

const chain = (result: unknown) => {
  const c: Record<string, jest.Mock> = {};
  for (const m of ['sort', 'skip', 'limit']) c[m] = jest.fn(() => c);
  c.exec = jest.fn(async () => result);
  return c;
};

function make(opts: { docs?: Array<Record<string, unknown>>; total?: number } = {}) {
  const docs = opts.docs ?? [];
  const model = {
    create: jest.fn(async (d: Record<string, unknown>) => ({ _id: new Types.ObjectId(), ...d })),
    find: jest.fn(() => chain(docs)),
    countDocuments: jest.fn(() => chain(opts.total ?? docs.length)),
    findById: jest.fn((id: string) =>
      chain(docs.find((d) => String(d._id) === String(id)) ?? null),
    ),
    updateOne: jest.fn(() => chain({ matchedCount: 1 })),
  };
  const service = new PersonService(model as never);
  return { service, model, docs };
}

describe('PersonService', () => {
  it('create сохраняет DTO', async () => {
    const { service, model } = make();
    const dto = { firstName: 'Иван', lastName: 'Иванов' };
    const doc = await service.create(dto);
    expect(model.create).toHaveBeenCalledWith(dto);
    expect(doc).toMatchObject(dto);
  });

  it('findAll: пагинация и поиск по фамилии', async () => {
    const id = new Types.ObjectId();
    const { service, model } = make({
      docs: [{ _id: id, firstName: 'Иван', lastName: 'Петров' }],
      total: 1,
    });
    const res = await service.findAll({ page: 2, limit: 10, search: 'Петр' });
    expect(res).toMatchObject({ total: 1, page: 2, limit: 10 });
    expect(res.items).toHaveLength(1);
    const filter = (model.find as jest.Mock).mock.calls[0][0] as { $or: Array<Record<string, RegExp>> };
    expect(filter.$or[0].lastName.test('Петров')).toBe(true);
  });

  it('findAll: limit не больше 100, page не меньше 1', async () => {
    const { service } = make();
    const res = await service.findAll({ page: 0, limit: 500 });
    expect(res.page).toBe(1);
    expect(res.limit).toBe(100);
  });

  it('findById: невалидный id → 404', async () => {
    const { service, model } = make();
    await expect(service.findById('bad')).rejects.toBeInstanceOf(NotFoundException);
    expect(model.findById).not.toHaveBeenCalled();
  });

  it('findById: нет документа → 404', async () => {
    const { service } = make({ docs: [] });
    await expect(service.findById(String(new Types.ObjectId()))).rejects.toBeInstanceOf(NotFoundException);
  });

  it('update меняет поля и save', async () => {
    const id = new Types.ObjectId();
    const doc = {
      _id: id,
      firstName: 'Иван',
      lastName: 'Иванов',
      save: jest.fn(async function (this: Record<string, unknown>) { return this; }),
    };
    const { service } = make({ docs: [doc] });
    const updated = await service.update(String(id), { firstName: 'Пётр' });
    expect(updated.firstName).toBe('Пётр');
    expect(doc.save).toHaveBeenCalled();
  });

  it('remove: soft-delete через deletedAt', async () => {
    const id = new Types.ObjectId();
    const doc = { _id: id, firstName: 'А', save: jest.fn() };
    const { service, model } = make({ docs: [doc] });
    await service.remove(String(id));
    expect(model.updateOne).toHaveBeenCalledWith(
      { _id: id },
      expect.objectContaining({ $set: expect.objectContaining({ deletedAt: expect.any(Date) }) }),
    );
  });
});
