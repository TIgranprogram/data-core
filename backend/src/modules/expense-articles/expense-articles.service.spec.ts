import { ExpenseArticlesService } from './expense-articles.service';
import { articleOfCategory, buildTree, PAYROLL_CODE, PAYROLL_PARENT, seedDocs } from './articles-tree';

type Doc = Record<string, unknown>;
/** Мини-коллекция: ровно те методы, что нужны сиду. */
function fakeConn() {
  const rows: Doc[] = [];
  const matches = (r: Doc, f: Doc) => Object.entries(f).every(([k, v]) => String(r[k] ?? '') === String(v ?? ''));
  const coll = {
    estimatedDocumentCount: async () => rows.length,
    insertMany: async (d: Doc[]) => { rows.push(...d); },
    insertOne: async (d: Doc) => { rows.push(d); },
    findOne: async (f: Doc) => rows.find((r) => matches(r, f)) ?? null,
    find: (f: Doc) => ({ toArray: async () => rows.filter((r) => matches(r, f)) }),
  };
  return { rows, conn: { db: { collection: () => coll } } as never };
}

describe('Статьи расходов: сид и дерево', () => {
  it('сид идемпотентен: второй запуск ничего не добавляет', async () => {
    const { rows, conn } = fakeConn();
    const svc = new ExpenseArticlesService(conn);
    const first = await svc.seed();
    const n = rows.length;
    expect(first.seeded).toBe(n);
    expect(rows.filter((r) => !r.parentId)).toHaveLength(14);
    expect(rows.filter((r) => r.code === PAYROLL_CODE)).toHaveLength(1);
    const second = await svc.seed();
    expect(second).toEqual({ seeded: 0, payroll: false });
    expect(rows).toHaveLength(n);
  });

  it('системная подстатья ФОТ дозасевается в уже заполненный справочник', async () => {
    const { rows, conn } = fakeConn();
    let i = 0;
    rows.push(...seedDocs(new Date(), () => `id${++i}`).filter((r) => r.code !== PAYROLL_CODE));
    const svc = new ExpenseArticlesService(conn);
    expect(await svc.seed()).toEqual({ seeded: 0, payroll: true });
    const payroll = rows.find((r) => r.code === PAYROLL_CODE)!;
    expect(rows.find((r) => String(r._id) === String(payroll.parentId))!.name).toBe(PAYROLL_PARENT);
  });

  it('дерево: два уровня, порядок, привязка к категориям; без родителя — отбрасывается', () => {
    const tree = buildTree([
      { _id: 'a', name: 'Б статья', sortOrder: 20 }, { _id: 'b', name: 'А статья', sortOrder: 10 },
      { _id: 'a1', name: 'Подстатья', parentId: 'a', sortOrder: 10, categoryIds: ['c1'] },
      { _id: 'x1', name: 'Сирота', parentId: 'нет', sortOrder: 10 },
    ]);
    expect(tree.map((t) => t.name)).toEqual(['А статья', 'Б статья']);
    expect(tree[1].children).toEqual([{ id: 'a1', name: 'Подстатья', sortOrder: 10, categoryIds: ['c1'] }]);
    expect(articleOfCategory(tree, 'c1')?.id).toBe('a1');
    expect(articleOfCategory(tree, 'c2')).toBeNull();
    expect(articleOfCategory(tree, undefined)).toBeNull();
  });
});
