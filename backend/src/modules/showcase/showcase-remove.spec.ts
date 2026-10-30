import { ConflictException } from '@nestjs/common';
import { Types } from 'mongoose';
import { ShowcaseService } from './showcase.service';

function setup(used: Record<string, number>) {
  const updateOne = jest.fn(async () => ({ matchedCount: 1 }));
  const coll = (n: string) => ({ findOne: async () => null, countDocuments: async () => used[n] ?? 0, updateOne });
  const svc = new ShowcaseService({ db: { collection: coll }, collection: coll } as never, {} as never);
  return { svc, updateOne };
}

describe('HARDEN-1 п.15: удаление изделия', () => {
  const id = String(new Types.ObjectId());
  it.each([['incomes', 'позициях заказов'], ['productpassports', 'паспортах'], ['designtasks', 'заданиях проектирования']])('ссылается %s — 409 с причиной', async (coll, what) => {
    const t = setup({ [coll]: 2 });
    await expect(t.svc.remove(id)).rejects.toThrow(new RegExp(what));
    expect(t.updateOne).not.toHaveBeenCalled();
  });
  it('без ссылок удаляется', async () => {
    const t = setup({});
    await expect(t.svc.remove(id)).resolves.toEqual({ id, deleted: true });
  });
  it('тип ошибки — Conflict', async () => {
    await expect(setup({ worktasks: 1 }).svc.remove(id)).rejects.toBeInstanceOf(ConflictException);
  });
});
