import type { Connection, Model } from 'mongoose';
import { StockCatalogNameService } from './stock-catalog-name.service';
import { normalizeCatalogName, StockCatalogNameSchema, type StockCatalogNameDocument } from './stock-catalog-name.schema';

const make = () => {
  const sessions: Array<{ withTransaction: jest.Mock; endSession: jest.Mock }> = [];
  const connection = { startSession: jest.fn(async () => {
    const session = { withTransaction: jest.fn(async (fn: () => Promise<unknown>) => fn()), endSession: jest.fn(async () => undefined) };
    sessions.push(session);
    return session;
  }) };
  const names = { createCollection: jest.fn(async () => undefined), findOneAndUpdate: jest.fn(() => ({ exec: async () => ({}) })) };
  const service = new StockCatalogNameService(connection as unknown as Connection, names as unknown as Model<StockCatalogNameDocument>);
  return { service, names, sessions, connection };
};

describe('T26: постоянная резервация имени', () => {
  it.each([
    ['  ТРУБА\t  40\n× 20 ', 'труба 40 × 20'],
    [' Bolt\u00a0 M8 ', 'bolt m8'],
    ['Ёж', 'ёж'],
    ['Еж', 'еж'],
    ['A+B [10]', 'a+b [10]'],
    ['Σ ς σ', 'σ σ σ'],
    ['ſ S K K', 's s k k'],
    ['ß ẞ SS', 'ß ß ss'],
    ['ı I İ', 'ı i İ'],
  ])('нормализация %s', (input, expected) => expect(normalizeCatalogName(input)).toBe(expected));

  it('схема имеет строковый _id без TTL/CRM индексов и отключает soft-delete', () => {
    expect(StockCatalogNameSchema.path('_id').instance).toBe('String');
    expect(StockCatalogNameSchema.get('softDelete')).toBe(false);
    expect(StockCatalogNameSchema.indexes()).toEqual([]);
  });

  it('создаёт только собственную коллекцию до транзакций', async () => {
    const { service, names } = make();
    await service.onModuleInit();
    expect(names.createCollection).toHaveBeenCalledTimes(1);
  });

  it('каждый вход пишет revision; ключи rename сортирует и дедуплицирует', async () => {
    const { service, names, sessions } = make();
    await service.run([' Z ', 'a', 'A'], async () => 7);
    await service.run(['a'], async () => 8);
    expect(names.findOneAndUpdate.mock.calls.map((call) => (call as unknown[])[0])).toEqual([{ _id: 'a' }, { _id: 'z' }, { _id: 'a' }]);
    expect(names.findOneAndUpdate).toHaveBeenCalledWith({ _id: 'a' }, { $inc: { revision: 1 } }, { upsert: true, session: sessions[0] });
    expect(sessions.every((s) => s.endSession.mock.calls.length === 1)).toBe(true);
  });

  it('E11000 только своего _id повторяет с новой session и snapshot', async () => {
    const { service, names, sessions } = make();
    names.findOneAndUpdate.mockImplementationOnce(() => ({ exec: async () => { throw { code: 11000, keyPattern: { _id: 1 }, keyValue: { _id: 'болт' } }; } }));
    const work = jest.fn(async () => 'done');
    await expect(service.run(['Болт'], work)).resolves.toBe('done');
    expect(work).toHaveBeenCalledTimes(1);
    expect(sessions).toHaveLength(2);
    expect(sessions[0]).not.toBe(sessions[1]);
  });

  it('ограничивает retry первой вставки пятью попытками', async () => {
    const { service, names, sessions } = make();
    const error = { code: 11000, keyPattern: { _id: 1 }, keyValue: { _id: 'x' } };
    names.findOneAndUpdate.mockImplementation(() => ({ exec: async () => { throw error; } }));
    await expect(service.run(['X'], async () => undefined)).rejects.toBe(error);
    expect(sessions).toHaveLength(5);
    expect(sessions.every((s) => s.endSession.mock.calls.length === 1)).toBe(true);
  });

  it.each([{ code: 11000, keyPattern: { sku: 1 } }, new Error('connection failed')])('не маскирует чужую ошибку', async (error) => {
    const { service, sessions } = make();
    await expect(service.run(['x'], async () => { throw error; })).rejects.toBe(error);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].endSession).toHaveBeenCalledTimes(1);
  });

  it('повтор callback драйвером возвращает результат последней попытки', async () => {
    const { service, connection } = make();
    const session = { withTransaction: async (fn: () => Promise<unknown>) => { await fn(); return fn(); }, endSession: jest.fn() };
    connection.startSession.mockResolvedValueOnce(session as never);
    let attempts = 0;
    await expect(service.run(['x'], async () => ++attempts)).resolves.toBe(2);
    expect(session.endSession).toHaveBeenCalledTimes(1);
  });
});
