import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { loadOrderMatches } from './match-facts';
import { MatchingService } from './matching.service';
import { aliasKey, blockText, isMatched, lineState, suggest, summarizeLines, type MatchProduct } from './matching-rules';

const P: MatchProduct[] = [
  { id: 'a', name: 'Скамейка парковая', sku: 'СК-3411', orderName: 'Скамья парковая со спинкой' },
  { id: 'b', name: 'Урна уличная', sku: 'УР-12' },
  { id: 'c', name: 'Трибуна', sku: 'ТР-7', fullName: 'Трибуна спортивная 4-рядная' },
];

describe('подбор совпадений (КМ2)', () => {
  it('название = orderName → топ-1 «почти наверняка»', () => {
    const [top] = suggest('Скамья парковая со спинкой, цвет: графит', P);
    expect(top).toMatchObject({ productId: 'a', reason: 'name', label: 'почти наверняка' });
  });
  it('артикул в тексте — высшая уверенность', () => {
    expect(suggest('Лавка ск-3411 по ТЗ', P)[0]).toMatchObject({ productId: 'a', reason: 'sku', percent: 95 });
  });
  it('сохранённое соответствие (алиас) — 98%', () => {
    expect(suggest('Что-то совсем иное', P, 'b')[0]).toMatchObject({ productId: 'b', reason: 'alias', percent: 98 });
  });
  it('похожие слова — «похоже»; нерелевантное отсекается; не больше 3', () => {
    const r = suggest('Урна уличная металлическая', P);
    expect(r[0].productId).toBe('b');
    expect(r[0].score).toBeLessThan(0.9);
    expect(suggest('Монтаж и доставка', P)).toEqual([]);
    expect(suggest('Скамейка парковая', [...P, ...P.map((p) => ({ ...p, id: p.id + '2' }))]).length).toBeLessThanOrEqual(3);
  });
  it('состояния: старое с изделием — сопоставлено, auto и пустое — нет, «не изделие» — да', () => {
    const o = new Types.ObjectId();
    expect(lineState({ productId: o })).toBe('legacy');
    expect(lineState({ matchStatus: 'auto', productId: o })).toBe('auto');
    expect(lineState({ matchStatus: 'confirmed' })).toBe('unmatched');
    expect(isMatched({ matchStatus: 'none' })).toBe(true);
    expect(isMatched({ title: 'x' })).toBe(false);
    expect(aliasKey('Трибуна, цвет: синий')).toBe('трибуна');
  });
  it('текст блока: «не сопоставлено N из M»; без позиций', () => {
    const m = summarizeLines([{ title: 'А', matchStatus: 'none' }, { title: 'Трибуна' }, { title: 'Урна' }]);
    expect(m).toMatchObject({ total: 3, matched: 1 });
    expect(blockText('12', m)).toBe('Договор № 12: не сопоставлено 2 из 3 позиций («Трибуна», «Урна»)');
    expect(blockText('7', { total: 0, matched: 0, unmatched: [] })).toBe('Договор № 7: нет позиций');
  });
});

describe('MatchingService (КМ2–КМ3)', () => {
  const orderId = new Types.ObjectId(), l1 = new Types.ObjectId(), l2 = new Types.ObjectId(), prod = new Types.ObjectId();
  let rows: Record<string, Array<Record<string, unknown>>>;
  let incUpdate: jest.Mock, aliasUpdate: jest.Mock, svc: MatchingService;
  beforeEach(() => {
    incUpdate = jest.fn(); aliasUpdate = jest.fn(() => ({ exec: async () => ({}) }));
    rows = {
      salesorders: [{ _id: orderId, orderNo: '12', customer: 'ООО' }],
      incomes: [{ _id: l1, orderId, lineNo: 1, title: 'Скамейка парковая, цвет: графит' }, { _id: l2, orderId, lineNo: 2, title: 'Монтаж' }],
      products: [{ _id: prod, name: 'Скамейка парковая', sku: 'СК-1' }],
    };
    const coll = (n: string) => {
      const mk = (f?: { _id?: { $in: unknown[] } }) => { const ids = f?._id?.$in?.map(String); const q = { sort: () => q, toArray: async () => (rows[n] ?? []).filter((r) => n !== 'products' || !ids || ids.includes(String(r._id))) }; return q; };
      return { find: (f?: never) => mk(f), findOne: async () => (rows[n] ?? [])[0] ?? null, updateOne: incUpdate };
    };
    const model = { find: () => ({ lean: () => ({ exec: async () => [] }) }), updateOne: aliasUpdate };
    svc = new MatchingService({ db: { collection: coll } } as never, model as never, { log: jest.fn() } as never);
  });

  it('suggest: предложения для несопоставленных, счётчики', async () => {
    const r = await svc.suggest(String(orderId));
    expect(r).toMatchObject({ total: 2, matched: 0, unmatched: 2 });
    expect(r.items[0].suggestions[0]).toMatchObject({ productId: String(prod), reason: 'name' });
    expect(r.items[0].confident).toBe(true);
    expect(r.items[1].suggestions).toEqual([]);
  });
  it('confirm: пишет productId/matchStatus и алиас (повтор — счётчик)', async () => {
    await svc.confirm(String(l1), String(prod), String(new Types.ObjectId()));
    expect(incUpdate.mock.calls[0][1].$set).toMatchObject({ matchStatus: 'confirmed', productId: prod });
    expect(aliasUpdate.mock.calls[0][0]).toEqual({ key: 'скамейка парковая' });
    expect(aliasUpdate.mock.calls[0][1].$inc).toEqual({ count: 1 });
  });
  it('none: «не изделие» снимает productId, алиас не пишется', async () => {
    await svc.none(String(l2));
    expect(incUpdate.mock.calls[0][1]).toMatchObject({ $set: { matchStatus: 'none' }, $unset: { productId: '' } });
    expect(aliasUpdate).not.toHaveBeenCalled();
  });
  it('bulk: дубль — 400, чужая позиция или изделие — 404, ничего не пишется', async () => {
    await expect(svc.bulk([{ lineId: String(l1), productId: null }, { lineId: String(l1), productId: null }])).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.bulk([{ lineId: String(new Types.ObjectId()), productId: null }])).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.bulk([{ lineId: String(l1), productId: String(new Types.ObjectId()) }])).rejects.toBeInstanceOf(NotFoundException);
    expect(incUpdate).not.toHaveBeenCalled();
  });
});

describe('loadOrderMatches (КМ4)', () => {
  it('договор без позиций → total 0; смесь → счёт «N из M»', async () => {
    const a = new Types.ObjectId(), b = new Types.ObjectId();
    const rows = [{ orderId: a, title: 'X', productId: new Types.ObjectId() }, { orderId: a, title: 'Монтаж' }];
    const db = { collection: () => ({ find: () => ({ sort: () => ({ toArray: async () => rows }) }) }) };
    const r = await loadOrderMatches(db as never, [a, b]);
    expect(r.get(String(a))).toEqual({ total: 2, matched: 1, unmatched: ['Монтаж'] });
    expect(r.get(String(b))?.total).toBe(0);
  });
});
