import { Types } from 'mongoose';
import { normalizeIds } from './id-normalize.interceptor';

describe('normalizeIds (T18)', () => {
  it('добавляет id из ObjectId _id', () => {
    const _id = new Types.ObjectId();
    const out = normalizeIds({ _id, name: 'x' }) as Record<string, unknown>;
    expect(out.id).toBe(_id.toHexString());
    expect(out._id).toBe(_id);
  });

  it('не перезаписывает существующий id', () => {
    const out = normalizeIds({ _id: new Types.ObjectId(), id: 'keep' }) as Record<string, unknown>;
    expect(out.id).toBe('keep');
  });

  it('обрабатывает списки {items} и вложенные populate', () => {
    const a = new Types.ObjectId();
    const b = new Types.ObjectId();
    const out = normalizeIds({ items: [{ _id: a, workType: { _id: b } }], total: 1 }) as {
      items: Array<{ id: string; workType: { id: string } }>;
    };
    expect(out.items[0].id).toBe(a.toHexString());
    expect(out.items[0].workType.id).toBe(b.toHexString());
  });

  it('строковый _id тоже даёт id', () => {
    expect((normalizeIds({ _id: 'abc' }) as { id: string }).id).toBe('abc');
  });

  it('не трогает Date, ObjectId, примитивы и экземпляры классов', () => {
    const d = new Date();
    const oid = new Types.ObjectId();
    class Foo { _id = 'x'; }
    const foo = new Foo();
    expect(normalizeIds(d)).toBe(d);
    expect(normalizeIds(oid)).toBe(oid);
    expect(normalizeIds('s')).toBe('s');
    expect(normalizeIds(null)).toBeNull();
    expect((normalizeIds(foo) as { id?: string }).id).toBeUndefined();
  });

  it('не уходит в бесконечную глубину', () => {
    let deep: Record<string, unknown> = { _id: 'leaf' };
    for (let i = 0; i < 50; i++) deep = { child: deep };
    expect(() => normalizeIds(deep)).not.toThrow();
  });
});
