import { Types } from 'mongoose';
import { DICT, type Doc } from './dicts.defs';

/** «Паспорта»: «Используется» — паспорта и ссылки по коду из других справочников группы (без них — удаление нужного). */
type Row = Record<string, unknown>;
const eq = (a: unknown, b: unknown) => String(a) === String(b);
function match(r: Row, q: Row): boolean {
  return Object.entries(q).every(([k, v]) => {
    if (k === '$and') return (v as Row[]).every((x) => match(r, x));
    const cur = r[k];
    if (v && typeof v === 'object' && !(v instanceof Types.ObjectId)) {
      const o = v as Row;
      if ('$nin' in o) return !(o.$nin as unknown[]).some((x) => (x == null ? cur == null : eq(cur, x)));
      if ('$ne' in o) return Array.isArray(cur) ? !cur.some((x) => eq(x, o.$ne)) : !eq(cur, o.$ne);
    }
    if (v === null) return cur == null;
    return Array.isArray(cur) ? cur.some((x) => eq(x, v)) : eq(cur, v);
  });
}
function fakeDb(data: Record<string, Row[]>) {
  return {
    collection: (name: string) => {
      const rows = () => data[name] ?? [];
      const cursor = (q: Row) => { const list = rows().filter((r) => match(r, q)); const c = { sort: () => c, limit: () => c, project: () => c, toArray: async () => list }; return c; };
      return { find: cursor, countDocuments: async (q: Row) => rows().filter((r) => match(r, q)).length };
    },
  } as never;
}

const id = () => new Types.ObjectId();
const cat = (code: string) => ({ _id: id(), dict: 'passportCategories', code, name: code, deletedAt: null });

describe('справочники «Паспорта»: где используется', () => {
  const TRN = cat('TRN'), DIO = cat('DIO'), ALL = cat('ALL');
  const std = { _id: id(), dict: 'passportStandards', code: 'GOST_R_57538', name: 'ГОСТ Р 57538', deletedAt: null };
  const bar = { _id: id(), dict: 'passportElements', code: 'HORIZONTAL_BAR', name: 'Турник', categories: 'TRN, WRK', standard: 'GOST_R_57538', deletedAt: null };
  const data = {
    dict_values: [TRN, DIO, ALL, std, bar, { ...cat('DSP'), standards: 'GOST_R_57538, GOST_R_55677' }],
    productpassports: [
      { _id: id(), passportCategory: 'TRN', elements: [bar._id], deletedAt: null },
      { _id: id(), passportCategory: 'TRN', deletedAt: null },
      { _id: id(), passportCategory: 'TRN', deletedAt: new Date() },
      { _id: id(), passportCategory: 'MAF', deletedAt: null },
    ],
  };
  const db = fakeDb(data);

  it('категория: паспорта по коду + элементы, ссылающиеся на код; ALL — все паспорта с категорией', async () => {
    const used = await DICT.get('passportCategories')!.usage(db, [TRN, DIO, ALL] as unknown as Doc[]);
    expect(used.get(String(TRN._id))).toBe(3); // 2 живых паспорта + элемент HORIZONTAL_BAR
    expect(used.get(String(DIO._id))).toBe(0);
    expect(used.get(String(ALL._id))).toBe(3);
  });

  it('норматив: категории и элементы, где указан его код', async () => {
    const used = await DICT.get('passportStandards')!.usage(db, [std] as unknown as Doc[]);
    expect(used.get(String(std._id))).toBe(2);
    const rel = await DICT.get('passportStandards')!.related(db, std as unknown as Doc);
    expect(rel.total).toBe(2);
    expect(rel.items.map((x) => x.label)).toEqual(['Категория: DSP', 'Элемент: Турник']);
  });

  it('элемент: паспорта по id', async () => {
    const used = await DICT.get('passportElements')!.usage(db, [bar] as unknown as Doc[]);
    expect(used.get(String(bar._id))).toBe(1);
  });
});
