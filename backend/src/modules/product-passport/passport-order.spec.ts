import { Types } from 'mongoose';
import { orderIssue, orderPlan, type OrderHost } from './passport-order';

/** ПНЗ: план и выпуск паспортов на весь заказ. */
describe('паспорта на весь заказ', () => {
  const o = new Types.ObjectId(), p1 = new Types.ObjectId(), p2 = new Types.ObjectId();
  const i1 = new Types.ObjectId(), i2 = new Types.ObjectId(), i3 = new Types.ObjectId(), i4 = new Types.ObjectId();
  const incomes = [
    { _id: i1, title: 'Урна А', qty: 2, lineNo: 1, productId: p1 },
    { _id: i2, title: 'Урна Б', qty: 1, lineNo: 2, productId: p2 },
    { _id: i3, title: 'Без изделия', qty: 1, lineNo: 3, productId: null },
    { _id: i4, title: 'Уже выпущена', qty: 1, lineNo: 4, productId: p1 },
  ];
  const make = (over: Partial<OrderHost> = {}) => {
    const passports: Array<Record<string, unknown>> = [{ _id: new Types.ObjectId(), incomeId: i4, status: 'issued', passportNumber: '777' }];
    const made: string[] = [], issuedIds: string[] = [], discarded: string[] = [];
    const col = (name: string) => ({
      findOne: async () => (name === 'salesorders' ? { _id: o, orderNo: '12-3', customer: 'Школа' } : null),
      find: (q: { incomeId?: { $in: Types.ObjectId[] } }) => ({
        sort: () => ({ toArray: async () => (name === 'incomes' ? incomes : name === 'productpassports' ? passports.filter((p) => q.incomeId!.$in.some((x) => x.equals(p.incomeId as Types.ObjectId))) : []) }),
        toArray: async () => (name === 'products' ? [{ _id: p1, name: 'Урна «А»', sku: 'У-1' }, { _id: p2, name: 'Урна «Б»' }] : []),
      }),
    });
    const host: OrderHost = {
      db: () => ({ collection: col }) as never,
      templateMissing: async (id) => (id === String(p2) ? ['Категория паспорта', 'Размеры'] : []),
      createDraft: async (incomeId) => { const _id = new Types.ObjectId(); made.push(incomeId); passports.push({ _id, incomeId: new Types.ObjectId(incomeId), status: 'draft', passportNumber: 'draft' }); return { id: String(_id) }; },
      hasOurSupplier: async () => true,
      issue: async (id) => { issuedIds.push(id); const p = passports.find((x) => String(x._id) === id)!; p.status = 'issued'; p.passportNumber = String(100 + issuedIds.length); },
      discard: async (id) => { discarded.push(id); },
      ...over,
    };
    return { host, made, issuedIds, discarded };
  };

  it('план: выпущен / готов / не хватает', async () => {
    const r = await orderPlan(make().host, String(o));
    expect(r).toMatchObject({ orderNo: '12-3', customerName: 'Школа', total: 4, issued: 1, ready: 1, blocked: 2 });
    expect(r.lines.map((l) => l.state)).toEqual(['ready', 'blocked', 'blocked', 'issued']);
    expect(r.lines[0]).toMatchObject({ qty: 2, productName: 'Урна «А»', article: 'У-1' });
    expect(r.lines[1].missing).toEqual(['Категория паспорта', 'Размеры']);
    expect(r.lines[2].missing).toEqual(['К позиции не привязано изделие']);
    expect(r.lines[3].passport).toMatchObject({ status: 'issued', number: '777' });
  });

  it('выпуск: готовые выпускаются, неготовые и выпущенные — в пропусках с причиной', async () => {
    const { host, made } = make();
    const r = await orderIssue(host, String(o));
    expect(r.issued).toHaveLength(1);
    expect(r.issued[0].incomeId).toBe(String(i1));
    expect(made).toEqual([String(i1)]);
    expect(r.skipped.map((s) => s.reason)).toEqual([expect.stringContaining('Не готово: Категория'), expect.stringContaining('не привязано'), expect.stringContaining('№ 777 уже выпущен')]);
  });

  it('повторный вызов не плодит дубли', async () => {
    const { host, made, issuedIds } = make();
    await orderIssue(host, String(o));
    const again = await orderIssue(host, String(o));
    expect(again.issued).toHaveLength(0);
    expect(made).toHaveLength(1);
    expect(issuedIds).toHaveLength(1);
    expect(again.skipped.find((s) => s.incomeId === String(i1))!.reason).toContain('уже выпущен');
  });

  it('выбранные позиции: чужой id — пропуск; свой черновик при ошибке выпуска убирается', async () => {
    const stranger = String(new Types.ObjectId());
    const { host, discarded } = make({ issue: async () => { throw Object.assign(new Error('x'), { response: { message: 'Не хватает для выпуска: Дата' } }); } });
    const r = await orderIssue(host, String(o), { lines: [String(i1), stranger] });
    expect(r.issued).toHaveLength(0);
    expect(discarded).toHaveLength(1);
    expect(r.skipped).toEqual([expect.objectContaining({ incomeId: String(i1), reason: 'Не выпущен: Не хватает для выпуска: Дата' }), expect.objectContaining({ incomeId: stranger, reason: 'Позиции нет в этом заказе' })]);
  });

  it('заказа нет — 404', async () => {
    const host = make().host;
    host.db = () => ({ collection: () => ({ findOne: async () => null }) }) as never;
    await expect(orderPlan(host, String(o))).rejects.toThrow('Заказ не найден');
  });

  it('план: нет «нашей фирмы» и нет поставщика у черновика — готовая позиция blocked с причиной', async () => {
    const r = await orderPlan(make({ hasOurSupplier: async () => false }).host, String(o));
    expect(r.lines[0]).toMatchObject({ state: 'blocked' });
    expect(r.lines[0].missing[0]).toMatch(/Поставщик/);
  });
});
