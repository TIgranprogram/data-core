import { Types } from 'mongoose';
import { FillAuditService } from './fill-audit.service';

const oid = () => new Types.ObjectId();

function cursor(rows: unknown[]) {
  const c = {
    sort() { return c; },
    limit() { return c; },
    toArray: async () => rows,
  };
  return c;
}

type Call = { name: string; op: string; filter?: unknown; options?: unknown };

describe('fill-audit — чтение shared через слой', () => {
  it('позиция без категории читается целиком и только живая', async () => {
    const calls: Call[] = [];
    const col = (name: string) => ({
      find: (filter?: unknown, options?: unknown) => {
        calls.push({ name, op: 'find', filter, options });
        return cursor(name === 'materials' ? [{ _id: 'm1', name: 'Лист', article: 'A-1' }] : []);
      },
      countDocuments: async (filter?: unknown) => {
        calls.push({ name, op: 'count', filter });
        return name === 'materials' ? 1 : 0;
      },
      aggregate: () => ({ toArray: async () => [] }),
    });
    const svc = new FillAuditService({ db: { collection: col } } as never);
    const res = await svc.report({ role: 'admin', isOwner: true }, { only: 'mat-category' });
    expect(res.groups[0]).toMatchObject({ key: 'mat-category', count: 1 });
    expect(res.groups[0].items[0]).toMatchObject({ id: 'm1', title: 'Лист', sub: 'арт. A-1' });
    const mat = calls.find((c) => c.name === 'materials' && c.op === 'find');
    expect(mat?.filter).toMatchObject({ deletedAt: null });
    expect(mat?.options).toEqual({});
    expect(calls.find((c) => c.name === 'products')).toBeUndefined();
  });

  it('сверка артикула: материалы живые, агрегат заявок сырой', async () => {
    const matId = oid();
    const calls: Call[] = [];
    const col = (name: string) => ({
      find: (filter?: unknown, options?: unknown) => {
        calls.push({ name, op: 'find', filter, options });
        const f = (filter ?? {}) as { _id?: unknown };
        if (name === 'materials' && f._id) return cursor([{ _id: matId, name: 'Лист', article: 'СКЛ-1' }]);
        if (name === 'materials') return cursor([]);
        return cursor([]);
      },
      countDocuments: async () => 0,
      aggregate: (pipeline?: unknown) => {
        calls.push({ name, op: 'aggregate', filter: pipeline });
        return { toArray: async () => (name === 'supplyrequests' ? [{ _id: matId, article: 'ART-9', num: 3 }] : []) };
      },
    });
    const svc = new FillAuditService({ db: { collection: col } } as never);
    const res = await svc.report({ role: 'admin', isOwner: true }, { only: 'mat-article' });
    expect(res.groups[0]).toMatchObject({ key: 'mat-article' });
    expect(res.groups[0].items[0].title).toBe('Лист');
    const mats = calls.filter((c) => c.name === 'materials' && c.op === 'find');
    expect(mats[0].filter).toMatchObject({ deletedAt: null });
    expect(mats[0].options).toEqual({ projection: { name: 1, article: 1 } });
    expect(mats[1].options).toEqual({ projection: { article: 1 } });
    expect(calls.some((c) => c.name === 'supplyrequests' && c.op === 'aggregate')).toBe(true);
    expect(calls.some((c) => c.name === 'supplyrequests' && c.op === 'find')).toBe(false);
  });
});
