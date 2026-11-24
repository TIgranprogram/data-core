import { Types } from 'mongoose';
import { DICT, type Doc } from './dicts.defs';

type Call = { name: string; op: string; filter?: unknown; options?: unknown };

function chain(rows: unknown[]) {
  const cursor = {
    sort() { return cursor; },
    limit() { return cursor; },
    project() { return cursor; },
    toArray: async () => rows,
  };
  return cursor;
}

function dbOf(calls: Call[], rows: Record<string, unknown[]> = {}) {
  return {
    collection: (name: string) => ({
      find: (filter?: unknown, options?: unknown) => {
        calls.push({ name, op: 'find', filter, options });
        return chain(rows[name] ?? []);
      },
      countDocuments: async (filter?: unknown, options?: unknown) => {
        calls.push({ name, op: 'count', filter, options });
        return rows[name]?.length ?? 0;
      },
      aggregate: () => ({ toArray: async () => [] }),
    }),
  };
}

describe('справочники — чтение shared через слой', () => {
  it('сортамент: позиции живые, проекция имени из контракта', async () => {
    const calls: Call[] = [];
    const rel = await DICT.get('metalAssortments')!.related(dbOf(calls) as never, { _id: new Types.ObjectId(), name: 'Лист' } as Doc);
    expect(rel.title).toBe('Позиции склада');
    const find = calls.find((c) => c.name === 'materials' && c.op === 'find');
    expect(find?.filter).toMatchObject({ deletedAt: null });
    expect(find?.options).toEqual({ projection: { name: 1 } });
  });

  it('отделы: у движений нет num в контракте — документ целиком', async () => {
    const calls: Call[] = [];
    await DICT.get('departments')!.related(dbOf(calls) as never, { _id: new Types.ObjectId(), name: 'Сварка' } as Doc);
    const find = calls.find((c) => c.name === 'stockmovements' && c.op === 'find');
    expect(find?.filter).toMatchObject({ deletedAt: null });
    expect(find?.options).toEqual({});
  });

  it('типы счетов: заявка читается полями контракта', async () => {
    const calls: Call[] = [];
    await DICT.get('invoiceTypes')!.related(dbOf(calls) as never, { _id: new Types.ObjectId(), name: 'УПД' } as Doc);
    const find = calls.find((c) => c.name === 'supplyrequests' && c.op === 'find');
    expect(find?.options).toEqual({ projection: { num: 1, title: 1, requestDate: 1 } });
    expect((find?.filter as { deletedAt?: unknown }).deletedAt).toBeNull();
  });

  it('сотрудник: имя снятого материала на выдаче сохраняется', async () => {
    const mat = new Types.ObjectId();
    const calls: Call[] = [];
    const rows = {
      stockmovements: [{ _id: new Types.ObjectId(), materialId: mat, qty: 2, date: null }],
      materials: [{ _id: mat, name: 'Труба', unit: 'м', deletedAt: new Date() }],
    };
    const rel = await DICT.get('persons')!.related(dbOf(calls, rows) as never, { _id: new Types.ObjectId(), firstName: 'Иван', lastName: 'Петров' } as Doc);
    expect(rel.more?.[0].items[0].label).toBe('Труба');
    const find = calls.find((c) => c.name === 'materials' && c.op === 'find');
    expect(find?.filter).toEqual({ _id: { $in: [mat] } });
    expect(find?.options).toEqual({ projection: { name: 1, unit: 1 } });
  });
});
