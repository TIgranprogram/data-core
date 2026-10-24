import { CounterService } from './counter.service';

describe('CounterService.nextSeq / setSeqAtLeast', () => {
  const mk = (findOneAndUpdate: jest.Mock, updateOne: jest.Mock = jest.fn()) =>
    new CounterService({ collection: () => ({ findOneAndUpdate, updateOne }) } as never);

  it('атомарный $inc без года, возвращает seq', async () => {
    const f = jest.fn().mockResolvedValue({ seq: 7 });
    expect(await mk(f).nextSeq('ProductSku', '12')).toBe(7);
    expect(f).toHaveBeenCalledWith({ entity: 'ProductSku', prefix: '12', year: 0 }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: 'after' });
  });

  it('E11000 — один повтор', async () => {
    const f = jest.fn().mockRejectedValueOnce({ code: 11000 }).mockResolvedValueOnce({ seq: 1 });
    expect(await mk(f).nextSeq('X', 'p')).toBe(1);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('другая ошибка пробрасывается', async () => {
    await expect(mk(jest.fn().mockRejectedValue(new Error('boom'))).nextSeq('X', 'p')).rejects.toThrow('boom');
  });

  it('setSeqAtLeast — $max, счётчик не опускается', async () => {
    const u = jest.fn().mockResolvedValue({});
    await mk(jest.fn(), u).setSeqAtLeast('ProductSku', '12', 79);
    expect(u).toHaveBeenCalledWith({ entity: 'ProductSku', prefix: '12', year: 0 }, { $max: { seq: 79 } }, { upsert: true });
  });
});
