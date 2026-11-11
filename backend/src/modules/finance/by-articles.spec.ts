import type { ArticleNode } from '../expense-articles/articles-tree';
import { buildByArticles, opsOfCell, NO_COUNTERPARTY, NO_CUSTOMER, NO_ORDER, type ByArticlesOpts } from './by-articles';
import type { Op } from './cashflow';

const tree: ArticleNode[] = [
  { id: 'T1', name: 'Расходные материалы', sortOrder: 10, children: [
    { id: 'S1', name: 'Металл - сталь', sortOrder: 10, categoryIds: [] }, { id: 'S2', name: 'Метизы', sortOrder: 20, categoryIds: [] } ] },
  { id: 'T2', name: 'Субподрядные работы', sortOrder: 20, children: [{ id: 'S3', name: 'Авансы подрядчикам', sortOrder: 10, categoryIds: [] }] },
  { id: 'T3', name: 'Организационные расходы', sortOrder: 30, children: [{ id: 'S4', name: 'З/п сотрудников (ФОТ)', code: 'payroll', sortOrder: 10, categoryIds: [] }] },
  { id: 'T4', name: 'Пустая', sortOrder: 40, children: [{ id: 'S5', name: 'Нет операций', sortOrder: 10, categoryIds: [] }] },
];
const TODAY = '2026-06-15';
const op = (p: Partial<Op> & { date: string; amount: number }): Op => ({ type: 'expense', id: Math.random().toString(36), company: 'СИЮ', title: 'x', ...p });
const company: ByArticlesOpts = { mode: 'company' };

describe('buildByArticles', () => {
  const ops = [
    op({ date: '2026-01-10', amount: 100, articleId: 'S1' }),
    op({ date: '2026-01-20', amount: 50, articleId: 'S2' }),
    op({ date: '2026-02-05', amount: 200, articleId: 'S1' }),
    op({ date: '2026-02-06', amount: 70, articleId: 'S3', counterparty: 'ООО Монтаж' }),
    op({ date: '2026-02-07', amount: 30, articleId: 'S3' }),
    op({ date: '2026-03-01', amount: 40, articleId: 'S4', source: 'payroll' }),
    op({ date: '2026-03-02', amount: 25 }), // без статьи
    op({ date: '2026-03-03', amount: 15, articleId: 'УДАЛЁН' }), // статья удалена — тоже «Без статьи»
    op({ type: 'income', date: '2026-01-15', amount: 1000 }),
    op({ type: 'income', date: '2026-03-15', amount: 500 }),
    op({ date: '2026-07-01', amount: 999, articleId: 'S1' }), // будущее — не считается
    op({ date: '2025-12-31', amount: 999, articleId: 'S1' }), // другой год
  ];
  const t = buildByArticles(ops, tree, 2026, TODAY, company);

  it('раскрытие: статья = сумма подстатей, нулевые скрыты', () => {
    expect(t.rows.map((r) => r.name)).toEqual(['Расходные материалы', 'Субподрядные работы', 'Организационные расходы']);
    const mat = t.rows[0];
    expect(mat.total).toBe(350);
    expect(mat.values.slice(0, 3)).toEqual([150, 200, 0]);
    expect(mat.children.map((c) => c.name)).toEqual(['Металл - сталь', 'Метизы']);
    expect(t.rows.some((r) => r.name === 'Пустая')).toBe(false);
  });

  it('доля — от всех расходов года, одна цифра после запятой', () => {
    expect(t.head.totals.expense).toBe(530);
    expect(t.rows[0].pct).toBe(66.0);
    expect(t.rows[0].children[1].pct).toBe(9.4);
  });

  it('«Без статьи» собирает и операции без статьи, и с удалённой статьёй', () => {
    expect(t.unassigned).toMatchObject({ total: 40, count: 2 });
  });

  it('сходится: статьи + «Без статьи» = расходы в шапке', () => {
    expect(t.rows.reduce((s, r) => s + r.total, 0) + t.unassigned.total).toBe(t.head.totals.expense);
    expect(t.unallocated).toBeUndefined();
  });

  it('прибыль, нарастающий итог и «доходы ÷ расходы» по месяцам', () => {
    expect(t.head.income.slice(0, 3)).toEqual([1000, 0, 500]);
    expect(t.head.totals).toEqual({ income: 1500, expense: 530, profit: 970 });
    expect(t.result.values.slice(0, 3)).toEqual([850, -300, 420]);
    expect(t.result.cumulative.slice(0, 3)).toEqual([850, 550, 970]);
    expect(t.result.ratio[0]).toBeCloseTo(6.67, 2);
    expect(t.result.ratio[5]).toBeNull();
  });

  it('третий уровень — контрагенты, если их несколько или единственный назван', () => {
    const sub = t.rows[1].children[0];
    expect(sub.children!.map((l) => [l.name, l.total])).toEqual([['ООО Монтаж', 70], [NO_COUNTERPARTY, 30]]);
    expect(t.rows[0].children[0].children).toBeUndefined(); // единственный «не указан» — уровня нет
    const named = buildByArticles([op({ date: '2026-01-10', amount: 10, articleId: 'S1', counterparty: 'Сталь-Опт' })], tree, 2026, TODAY, company);
    expect(named.rows[0].children[0].children!.map((l) => l.name)).toEqual(['Сталь-Опт']);
  });

  it('будущие месяцы и чужой год — нули', () => {
    expect(t.head.expense.slice(6)).toEqual(Array(6).fill(0));
  });

  it('нет двойного учёта: одна операция — одна строка (заявка и строка снимка приходят одной операцией)', () => {
    const once = buildByArticles([op({ date: '2026-02-01', amount: 100, articleId: 'S1', source: 'invoice', id: 'r1' })], tree, 2026, TODAY, company);
    expect(once.head.totals.expense).toBe(100);
  });
});

describe('buildByArticles: доходы по заказчикам и «Без подстатьи» (C084)', () => {
  const ops = [
    op({ type: 'income', date: '2026-01-10', amount: 300, counterparty: 'ООО Заказчик', doc: 'заказ 1' }),
    op({ type: 'income', date: '2026-02-10', amount: 200, counterparty: 'ООО Заказчик', doc: 'заказ 2' }),
    op({ type: 'income', date: '2026-02-11', amount: 100, counterparty: 'ООО Заказчик' }),
    op({ type: 'income', date: '2026-03-10', amount: 900, counterparty: 'ИП Иванов', doc: 'заказ 3' }),
    op({ type: 'income', date: '2026-03-11', amount: 50 }),
    op({ date: '2026-01-05', amount: 40, articleId: 'T1' }), // расход прямо на статью верхнего уровня
    op({ date: '2026-01-06', amount: 60, articleId: 'S1' }),
  ];
  const t = buildByArticles(ops, tree, 2026, TODAY, company);

  it('incomeRows: заказчик → заказы, по убыванию, доли от всех доходов', () => {
    expect(t.incomeRows.map((r) => [r.id, r.name, r.total, r.pct])).toEqual([
      ['cp:ИП Иванов', 'ИП Иванов', 900, 58.1], ['cp:ООО Заказчик', 'ООО Заказчик', 600, 38.7], ['cp:' + NO_CUSTOMER, NO_CUSTOMER, 50, 3.2],
    ]);
    const c = t.incomeRows[1];
    expect(c.children.map((x) => [x.id, x.name, x.total])).toEqual([['ord:заказ 1', 'заказ 1', 300], ['ord:заказ 2', 'заказ 2', 200], ['ord:', NO_ORDER, 100]]);
    expect(c.values.slice(0, 3)).toEqual([300, 300, 0]);
  });

  it('сумма incomeRows = доходы в шапке', () => {
    expect(t.incomeRows.reduce((s, r) => s + r.total, 0)).toBe(t.head.totals.income);
    expect(t.incomeRows.every((r) => r.children.reduce((s, x) => s + x.total, 0) === r.total)).toBe(true);
  });

  it('расход на статью верхнего уровня → строка «Без подстатьи», не «Без статьи»', () => {
    const mat = t.rows[0];
    expect(mat.children.map((c) => [c.id, c.name, c.total])).toEqual([['S1', 'Металл - сталь', 60], ['T1:self', 'Без подстатьи', 40]]);
    expect(t.unassigned.total).toBe(0);
    expect(t.rows.reduce((s, r) => s + r.total, 0) + t.unassigned.total).toBe(t.head.totals.expense);
  });

  it('opsOfCell: :self, counterparty, doc', () => {
    const amounts = (a: string, extra = {}) => opsOfCell(ops, tree, 2026, TODAY, company, a, undefined, extra).map((o) => o.amount);
    expect(amounts('T1:self')).toEqual([40]);
    expect(amounts('T1')).toEqual([40, 60]);
    expect(amounts('none')).toEqual([]);
    expect(amounts('income', { counterparty: 'ООО Заказчик' })).toEqual([300, 200, 100]);
    expect(amounts('income', { counterparty: NO_CUSTOMER })).toEqual([50]);
    expect(amounts('income', { counterparty: 'ООО Заказчик', doc: 'заказ 2' })).toEqual([200]);
    expect(amounts('income', { counterparty: 'ООО Заказчик', doc: NO_ORDER })).toEqual([100]);
  });
});

describe('buildByArticles: режим объекта', () => {
  const obj: ByArticlesOpts = { mode: 'object', salesOrderId: 'O1', orderNo: '12', contractPrice: 2000 };
  const ops = [
    op({ type: 'income', date: '2026-02-01', amount: 800, salesOrderId: 'O1' }),
    op({ type: 'income', date: '2026-02-02', amount: 999, salesOrderId: 'O2' }),
    op({ date: '2026-02-03', amount: 400, articleId: 'S1', salesOrderId: 'O1' }),
    op({ date: '2026-02-04', amount: 300, articleId: 'S1', salesOrderId: 'O2' }), // чужой объект
    op({ date: '2026-02-05', amount: 90, articleId: 'S2' }), // без объекта, не ФОТ — в объект не входит
    op({ date: '2026-02-06', amount: 60, articleId: 'S4', source: 'payroll' }),
    op({ date: '2026-02-07', amount: 20, salesOrderId: 'O1' }),
  ];
  const t = buildByArticles(ops, tree, 2026, TODAY, obj);

  it('доходы и расходы — только этого объекта; ФОТ без объекта — отдельной строкой', () => {
    expect(t.head.totals).toEqual({ income: 800, expense: 480, profit: 320 });
    expect(t.unallocated).toMatchObject({ total: 60 });
    expect(t.unassigned.total).toBe(20);
    expect(t.rows.map((r) => r.name)).toEqual(['Расходные материалы']);
    expect(t.rows.reduce((s, r) => s + r.total, 0) + t.unassigned.total + t.unallocated!.total).toBe(t.head.totals.expense);
  });

  it('проценты — от цены контракта', () => {
    expect(t.rows[0].pct).toBe(20);
    expect(t.scope).toMatchObject({ mode: 'object', salesOrderId: 'O1', orderNo: '12', contractPrice: 2000 });
  });

  it('без цены контракта проценты — от расходов объекта', () => {
    const x = buildByArticles(ops, tree, 2026, TODAY, { ...obj, contractPrice: 0 });
    expect(x.rows[0].pct).toBe(83.3);
  });
});

describe('opsOfCell', () => {
  const ops = [
    op({ id: 'a', date: '2026-01-10', amount: 100, articleId: 'S1' }),
    op({ id: 'b', date: '2026-02-10', amount: 50, articleId: 'S2' }),
    op({ id: 'c', date: '2026-02-11', amount: 5 }),
    op({ id: 'd', type: 'income', date: '2026-02-12', amount: 9 }),
  ];
  const ids = (a: string, m?: string) => opsOfCell(ops, tree, 2026, TODAY, company, a, m).map((o) => o.id);
  it('подстатья, статья, месяц, «Без статьи», доходы', () => {
    expect(ids('S1')).toEqual(['a']);
    expect(ids('T1')).toEqual(['a', 'b']);
    expect(ids('T1', '2026-02')).toEqual(['b']);
    expect(ids('none')).toEqual(['c']);
    expect(ids('income')).toEqual(['d']);
    expect(ids('expense')).toEqual(['a', 'b', 'c']);
  });
});
