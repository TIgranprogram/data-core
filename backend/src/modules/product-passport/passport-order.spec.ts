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
  const make = (over: Partial<OrderHost> = {}, opt: { orgs?: Array<Record<string, unknown>>; companyId?: Types.ObjectId } = {}) => {
    const passports: Array<Record<string, unknown>> = [{ _id: new Types.ObjectId(), incomeId: i4, status: 'issued', passportNumber: '777' }];
    const orgs = opt.orgs || [];
    const made: string[] = [], drafts: string[] = [], issuedIds: string[] = [], discarded: string[] = [], supplied: string[] = [];
    const col = (name: string) => ({
      findOne: async (q?: { _id?: Types.ObjectId }) => {
        if (name === 'salesorders') return { _id: o, orderNo: '12-3', customer: 'Школа', companyId: opt.companyId };
        if (name === 'organizations' && q?._id) return orgs.find((x) => String(x._id) === String(q._id)) ?? null;
        return null;
      },
      find: (q: { incomeId?: { $in: Types.ObjectId[] } }) => ({
        sort: () => ({ toArray: async () => (name === 'incomes' ? incomes : name === 'productpassports' ? passports.filter((p) => q.incomeId!.$in.some((x) => x.equals(p.incomeId as Types.ObjectId))) : name === 'organizations' ? orgs : []) }),
        toArray: async () => (name === 'products' ? [{ _id: p1, name: 'Урна «А»', sku: 'У-1' }, { _id: p2, name: 'Урна «Б»' }] : []),
      }),
    });
    const host: OrderHost = {
      db: () => ({ collection: col }) as never,
      templateMissing: async (id) => (id === String(p2) ? ['Категория паспорта', 'Размеры'] : []),
      createDraft: async (incomeId, _title, supplierOrgId) => { const _id = new Types.ObjectId(); made.push(incomeId); if (supplierOrgId) drafts.push(supplierOrgId); passports.push({ _id, incomeId: new Types.ObjectId(incomeId), status: 'draft', passportNumber: 'draft' }); return { id: String(_id) }; },
      setSupplier: async (_id, supplierOrgId) => { supplied.push(supplierOrgId); },
      hasOurSupplier: async () => true,
      issue: async (id) => { issuedIds.push(id); const p = passports.find((x) => String(x._id) === id)!; p.status = 'issued'; p.passportNumber = String(100 + issuedIds.length); },
      discard: async (id) => { discarded.push(id); },
      ...over,
    };
    return { host, made, drafts, issuedIds, discarded, supplied };
  };

  it('план: выпущен / готов / не хватает', async () => {
    const r = await orderPlan(make().host, String(o));
    expect(r).toMatchObject({ orderNo: '12-3', customerName: 'Школа', total: 4, issued: 1, ready: 1, blocked: 2 });
    expect(r.lines.map((l) => l.state)).toEqual(['ready', 'blocked', 'blocked', 'issued']);
    expect(r.lines[0]).toMatchObject({ qty: 2, productName: 'Урна «А»', article: 'У-1' });
    expect(r.lines[1].missing).toEqual(['Категория паспорта', 'Размеры']);
    expect(r.lines[2].missing).toEqual(['К позиции не привязано изделие']);
    expect(r.lines[3].passport).toMatchObject({ status: 'issued', number: '777' });
    expect(r.firm).toBeNull();
    expect(r.firmChoices).toEqual([]);
  });
  it('повторные позиции одного изделия используют одну проверку, битое фото блокирует обе', async () => {
    const templateMissing = jest.fn<Promise<string[]>, [string]>(async () => ['Обязательный рисунок не читается: Фото изделия']);
    const { host } = make({ templateMissing });
    const db = host.db();
    host.db = () => ({ collection: (name: string) => name === 'productpassports'
      ? { find: () => ({ sort: () => ({ toArray: async () => [] }) }) }
      : db.collection(name) }) as never;
    const result = await orderPlan(host, String(o));
    const repeated = result.lines.filter((line) => line.productId === String(p1));
    expect(repeated).toHaveLength(2);
    expect(repeated.every((line) => line.state === 'blocked' && line.missing[0].includes('Фото изделия'))).toBe(true);
    expect(templateMissing.mock.calls.filter(([id]) => id === String(p1))).toHaveLength(1);
  });
  it('категории разных групп и общего родителя читаются двумя пакетами', async () => {
    const host = make().host;
    const base = host.db();
    const g1 = new Types.ObjectId(), g2 = new Types.ObjectId(), parent = new Types.ObjectId();
    const reads: string[] = [];
    host.db = () => ({ collection: (name: string) => {
      if (!['products', 'categories', 'dict_values'].includes(name)) return base.collection(name);
      return { find: (q: { _id?: { $in: Types.ObjectId[] }; deletedAt?: unknown }) => ({ toArray: async () => {
        reads.push(name);
        if (name === 'products') return [{ _id: p1, categoryId: g1 }, { _id: p2, categoryId: g2 }];
        if (name === 'dict_values') return [{ code: 'BLG', name: 'Благоустройство' }, { code: 'TRN', name: 'Тренажёры' }];
        expect(q.deletedAt).toBeNull();
        return q._id!.$in.some((id) => id.equals(parent)) ? [{ _id: parent, name: 'Раздел', passportCategory: 'BLG' }] : [{ _id: g1, name: 'Группа 1', parentId: parent }, { _id: g2, name: 'Группа 2', parentId: parent, passportCategory: 'TRN' }];
      } }) };
    } }) as never;
    const r = await orderPlan(host, String(o));
    expect(r.lines.slice(0, 2).map((l) => l.categoryName)).toEqual(['Благоустройство', 'Тренажёры']);
    expect(reads.filter((n) => n === 'categories')).toHaveLength(2);
    expect(reads.filter((n) => n === 'dict_values')).toHaveLength(1);
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
    expect(r.lines[0].missing[0]).toMatch(/фирм/);
    expect(r.firm).toBeNull();
  });

  it('план: несколько наших фирм и нет фирмы заказа — firmChoices и тупик, пока фирму не выбрали', async () => {
    const a = new Types.ObjectId(), b = new Types.ObjectId();
    const orgs = [{ _id: a, shortName: 'СИЮ', name: 'СпортИнЮг' }, { _id: b, name: 'СтройСнабЮг' }];
    const r = await orderPlan(make({ hasOurSupplier: async () => false }, { orgs }).host, String(o));
    expect(r.firm).toBeNull();
    expect(r.firmChoices.map((f) => f.name)).toEqual(['СИЮ', 'СтройСнабЮг']);
    expect(r.lines[0]).toMatchObject({ state: 'blocked', missing: ['Выберите фирму'] });
    const picked = await orderPlan(make({ hasOurSupplier: async () => false }, { orgs }).host, String(o), undefined, String(a));
    expect(picked.firm).toBeNull();
    expect(picked.lines[0].state).toBe('ready');
  });

  it('план: фирма заказа снимает тупик, даже если наших фирм несколько', async () => {
    const a = new Types.ObjectId(), b = new Types.ObjectId();
    const orgs = [{ _id: a, shortName: 'СИЮ', name: 'СпортИнЮг' }, { _id: b, shortName: 'ССЮ' }];
    const r = await orderPlan(make({ hasOurSupplier: async () => false }, { orgs, companyId: a }).host, String(o));
    expect(r.firm).toEqual({ id: String(a), name: 'СИЮ' });
    expect(r.lines[0].state).toBe('ready');
  });

  it('выпуск с выбранной фирмой передаёт её в черновик', async () => {
    const a = new Types.ObjectId(), b = new Types.ObjectId();
    const orgs = [{ _id: a, shortName: 'СИЮ' }, { _id: b, shortName: 'ССЮ' }];
    const { host, drafts, supplied } = make({ hasOurSupplier: async () => false }, { orgs });
    const r = await orderIssue(host, String(o), { supplierOrgId: String(a) });
    expect(r.issued).toHaveLength(1);
    expect(drafts).toEqual([String(a)]);
    expect(supplied).toEqual([String(a)]);
  });
});
