import { Types } from 'mongoose';
import { orderDeadline, personView, presentTasks } from './design-present';

describe('design-present', () => {
  it('personView: имя «Фамилия Имя» и инициалы; пусто — «?»', () => {
    const id = new Types.ObjectId();
    expect(personView({ _id: id, lastName: 'Иванов', firstName: 'Пётр' })).toEqual({ id: String(id), name: 'Иванов Пётр', initials: 'ИП' });
    expect(personView({ _id: id }).initials).toBe('?');
  });

  it('orderDeadline: срок изготовления, иначе отгрузка, иначе null', () => {
    const a = new Date('2026-01-01'), b = new Date('2026-02-02');
    expect(orderDeadline({ productionDeadline: a, shipDate: b })).toBe(a);
    expect(orderDeadline({ shipDate: b })).toBe(b);
    expect(orderDeadline(undefined)).toBeNull();
  });

  const conn = (rows: Record<string, Array<Record<string, unknown>>>) => ({
    db: { collection: (n: string) => ({ aggregate: () => ({ toArray: async () => rows[n] ?? [] }), find: () => ({ toArray: async () => rows[n] ?? [] }) }) },
  }) as never;

  it('пустой список — пустой ответ', async () => {
    expect(await presentTasks(conn({}), [])).toEqual([]);
  });

  it('заголовок авто, срок и приоритет из заказа; свои (manual) приоритетнее', async () => {
    const oid = new Types.ObjectId(), iid = new Types.ObjectId(), pid = new Types.ObjectId();
    const ship = new Date('2026-03-03'), own = new Date('2026-04-04');
    const rows = {
      salesorders: [{ _id: oid, orderNo: '77', shipDate: ship, priority: 'urgent' }],
      incomes: [{ _id: iid, lineNo: 2, title: 'Скамья', productId: pid }],
      products: [{ _id: pid, name: 'Скамья парковая', sku: '3410' }],
    };
    const [a, b, c] = await presentTasks(conn(rows), [
      { _id: new Types.ObjectId(), seq: 5, status: 'new', orderId: oid, incomeId: iid },
      { _id: new Types.ObjectId(), seq: 6, status: 'new', orderId: oid, incomeId: iid, title: 'Моё', manual: { deadline: own, priority: 'low' } },
      { _id: new Types.ObjectId(), seq: 7, status: 'new' },
    ]);
    expect(a).toMatchObject({ code: 'D-5', title: 'Чертежи 3410 ЗНП 77 поз 2', deadline: ship, deadlineFromOrder: true, priority: 'urgent', priorityFromOrder: true, sku: '3410' });
    expect(b).toMatchObject({ title: 'Моё', deadline: own, deadlineFromOrder: false, priority: 'low', priorityFromOrder: false });
    expect(c).toMatchObject({ title: 'Без названия', priority: 'normal', deadline: null, assignee: null, photo: null });
  });
});
