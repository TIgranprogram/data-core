import { Types } from 'mongoose';
import { ExpenseArticlesService } from './expense-articles.service';
describe('C161: история usage не читается без явного действия', () => {
  it('обычное дерево не обращается к финансовым источникам', async () => {
    const collection = jest.fn(() => { throw new Error('История не должна читаться'); }), service = new ExpenseArticlesService({ db: { collection } } as never);
    jest.spyOn(service, 'docs').mockResolvedValue([{ _id: new Types.ObjectId(), name: 'Группа' }]);
    const result = await service.financialList();
    expect(result.total).toBe(1); expect(result.items[0]).not.toHaveProperty('usage'); expect(collection).not.toHaveBeenCalled();
  });
  it('явный usage ста статей считается пакетно, без N+1', async () => {
    const rows = Array.from({ length: 100 }, (_, i) => ({ _id: new Types.ObjectId(), name: 'Группа ' + i }));
    const aggregate = jest.fn((coll: string) => ({ toArray: async () => coll === 'expenses' ? [{ _id: rows[0]._id, n: 2 }] : [] }));
    const collection = jest.fn((name: string) => ({ aggregate: () => aggregate(name), findOne: async () => null }));
    const service = new ExpenseArticlesService({ db: { collection } } as never); jest.spyOn(service, 'docs').mockResolvedValue(rows);
    const result = await service.financialList({ includeUsage: true });
    expect(result.total).toBe(100); expect(result.items.find(n => n.id === String(rows[0]._id))?.usage?.total).toBe(2);
    expect(aggregate.mock.calls.length).toBeLessThanOrEqual(10);
  });
});
