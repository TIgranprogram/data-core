import { Types } from 'mongoose';
import { nextSku } from './showcase-sku';

/** Автоартикул группы (ПРЖ-1): групп-номер + два знака монотонного счётчика; занятые (и в корзине) пропускаются. */
describe('nextSku', () => {
  const gid = new Types.ObjectId();
  const mk = (groupNo: string | null, taken: string[]) => {
    const skus = new Set(taken);
    const db = { collection: (c: string) => ({
      findOne: async (f: { sku?: RegExp }) => (c === 'categories' ? { _id: gid, name: 'Скамьи', groupNo } : f.sku && [...skus].some((s) => f.sku!.test(s)) ? { _id: 1 } : null),
    }) };
    const seqs = new Map<string, number>();
    const counter = { nextSeq: jest.fn(async (e: string, p: string) => { const k = e + p; seqs.set(k, (seqs.get(k) ?? 0) + 1); return seqs.get(k)!; }) };
    return { db: db as never, counter: counter as never, skus };
  };

  it('без номера группы — null', async () => {
    const t = mk(null, []);
    expect(await nextSku(t.db, t.counter, gid)).toBeNull();
    expect(await nextSku(t.db, t.counter, null)).toBeNull();
  });

  it('пропускает занятые (в т. ч. из корзины и ручные)', async () => {
    const t = mk('12', ['1201', '1202', '1204']);
    expect((await nextSku(t.db, t.counter, gid))!.sku).toBe('1203');
    expect((await nextSku(t.db, t.counter, gid))!.sku).toBe('1205');
  });

  it('номер после удаления не повторяется: счётчик идёт вперёд', async () => {
    const t = mk('12', []);
    const a = (await nextSku(t.db, t.counter, gid))!.sku;
    t.skus.add(a); t.skus.delete(a); // создали и удалили (физически)
    expect((await nextSku(t.db, t.counter, gid))!.sku).not.toBe(a);
  });

  it('два параллельных вызова — разные артикулы', async () => {
    const t = mk('12', []);
    const r = await Promise.all([nextSku(t.db, t.counter, gid), nextSku(t.db, t.counter, gid)]);
    expect(r[0]!.sku).not.toBe(r[1]!.sku);
  });

  it('предупреждение с 90-го, после 99 — 409', async () => {
    const t = mk('12', []);
    for (let i = 1; i < 90; i++) await nextSku(t.db, t.counter, gid);
    expect((await nextSku(t.db, t.counter, gid))!.warning).toContain('Скамьи');
    for (let i = 91; i <= 99; i++) await nextSku(t.db, t.counter, gid);
    await expect(nextSku(t.db, t.counter, gid)).rejects.toThrow('заняты номера 01–99');
  });
});
