import { ConflictException } from '@nestjs/common';
import { PassportNumbers } from './passport-numbers';
import { nextSeq } from './passport-rules';

/** Счётчики и максимум на памяти — без Mongo. */
function make(max = 549, seq = 549) {
  const c: Record<string, number> = { passportNumber: seq, productCode: 10 };
  const coll = {
    findOne: async (q: { prefix: string }) => ({ seq: c[q.prefix] }),
    updateOne: async (q: { prefix: string }, u: { $set: { seq: number } }) => { c[q.prefix] = u.$set.seq; },
    findOneAndUpdate: async (q: { prefix: string }, p: Array<{ $set: { seq: unknown } }>, o: unknown) => { void p; void o; c[q.prefix] += 1; return { seq: c[q.prefix] }; },
  };
  const n = new PassportNumbers({ connection: { collection: () => coll } as never, maxOf: async (f) => (f === 'passportNumber' ? max : 10) });
  return { n, c };
}

describe('PassportNumbers (ПН)', () => {
  it('показ: следующий № и талон', async () => {
    const { n } = make();
    expect(await n.nextNumbers(new Date(Date.UTC(2026, 9, 13)))).toMatchObject({ lastPassportNo: 549, nextPassportNo: 550, nextWarrantyCode: '202610-550' });
  });

  it('next > max — счётчик сдвинут, следующий выпуск получит этот №', async () => {
    const { n, c } = make();
    const r = await n.setNext({ next: 700 });
    expect(c.passportNumber).toBe(699);
    expect(r.nextPassportNo).toBe(700);
    expect(await nextSeq(({ findOneAndUpdate: async () => ({ seq: c.passportNumber + 1 }) }) as never, 'passportNumber', 549)).toBe(700);
  });

  it('next <= max — 409', async () => {
    const { n, c } = make();
    await expect(n.setNext({ next: 549 })).rejects.toBeInstanceOf(ConflictException);
    await expect(n.setNext({ next: 10 })).rejects.toThrow('не меньше 550');
    expect(c.passportNumber).toBe(549);
  });

  it('№ изделия: задать следующий; меньше занятого — 409; № паспорта не трогается', async () => {
    const { n, c } = make();
    const r = await n.setNext({ nextProductCode: 2600 });
    expect(c.productCode).toBe(2599);
    expect(r.nextProductCode).toBe(2600);
    expect(c.passportNumber).toBe(549);
    await expect(n.setNext({ nextProductCode: 5 })).rejects.toThrow('№ изделия 5 уже занят');
  });
});
