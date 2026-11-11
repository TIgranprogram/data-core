import { api } from '../core/api.js';
import { h } from '../core/dom.js';
import { money } from '../core/format.js';
import { go, patch } from '../core/router.js';
import { button, empty, link, segmented, select, enhanceSelect, failBlock, stats, toolbar, treeTable } from '../ui/kit/index.js';
import { orderChoices } from './expenses.js';

/**
 * «Деньги → По статьям» (C027, C084): таблица для директора — доходы и расходы по месяцам или кварталам.
 * Строка раскрывается без запросов (статья › подстатья › контрагент; доходы: заказчик › заказ), нажатие на сумму —
 * операции вставкой под строкой, нажатие на операцию — карточка справа (opRow передаёт money.js).
 * Сервер: GET /finance/by-articles?year&org&mode&salesOrderId, GET /finance/by-articles/ops (articleId, month?, counterparty?, doc?).
 * Новые поля ответа (incomeRows, children у подстатей) могут отсутствовать — тогда строка просто не раскрывается. Только факт.
 */
const MON = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'];
const MON_FULL = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
const QUARTER = ['I', 'II', 'III', 'IV'];
const PERIOD_KEY = 'dc-money-articles-period';
const opened = new Set(); // раскрытые строки — помним между перерисовками и сменой года
const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* */ } } };

const num = (v, strong) => {
  const n = Number(v) || 0;
  return n === 0 ? h('span', { class: 'num muted' }, '—') : h('span', { class: 'num' + (n < 0 ? ' neg' : '') + (strong ? ' strong' : '') }, money(n).replace(' ₽', ''));
};
const pctText = (p) => String(Math.round(Number(p) * 10) / 10).replace('.', ',') + '%';
const ratioCell = (v) => (v == null ? h('span', { class: 'num muted' }, '—') : h('span', { class: 'num' }, String(Math.round(Number(v) * 100) / 100).replace('.', ',')));
const sum = (a, idxs) => idxs.reduce((s, i) => s + (Number(a?.[i]) || 0), 0);
const sameName = (a, b) => (a || '').trim() === (b || '').trim();

export function articlesView({ year, org, mode, order, opRow, noIncomeText }) {
  const objectMode = mode === 'object';
  const el = h('div');
  const bar = toolbar();
  const out = h('div');
  el.append(bar, out);
  let data = null;
  let query = {};
  let tt = null; // treeTable текущей перерисовки
  let insKey = null;
  let quarters = store.get(PERIOD_KEY) === 'quarters';

  const now = new Date();
  const curIdx = Number(year) === now.getFullYear() ? now.getMonth() : Number(year) < now.getFullYear() ? 11 : -1; // последний месяц, по который есть факт
  const groups = () => (quarters ? [[0, 1, 2], [3, 4, 5], [6, 7, 8], [9, 10, 11]] : MON.map((_, i) => [i]));
  const periodTitle = (idxs) => (idxs.length === 1 ? `${MON_FULL[idxs[0]]} ${year}` : `${QUARTER[idxs[0] / 3]} квартал ${year}`);

  const paintBar = async () => {
    const kids = [segmented({ cls: 'seg', label: 'Что показать', items: [{ key: 'company', label: 'Все заказы' }, { key: 'object', label: 'Один заказ' }], value: objectMode ? 'object' : 'company',
      onChange: (k) => patch({ mode: k === 'object' ? 'object' : undefined, order: undefined }) }).el];
    if (objectMode) {
      const sel = select({ options: await orderChoices('Выберите объект'), value: order || '', label: 'Объект (заказ)', onChange: (v) => patch({ order: v || undefined }) });
      kids.push(sel);
      enhanceSelect(sel, { force: true });
    }
    kids.push(segmented({ cls: 'seg', label: 'Период таблицы', items: [{ key: 'months', label: 'Месяцы' }, { key: 'quarters', label: 'Кварталы' }], value: quarters ? 'quarters' : 'months',
      onChange: (k) => { quarters = k === 'quarters'; store.set(PERIOD_KEY, k); if (data) paint(); } }).el,
    button({ label: 'Раскрыть всё', kind: 'ghost', size: 'S', onClick: () => tt?.expandAll() }),
    button({ label: 'Свернуть всё', kind: 'ghost', size: 'S', onClick: () => tt?.collapseAll() }));
    bar.replaceChildren(...kids);
  };

  /** Операции под строкой: idxs — месяцы (null — весь год); extra — counterparty / doc. */
  async function showOps(rowId, articleId, extra, idxs, title) {
    const key = `${rowId}|${idxs ? idxs.join(',') : 'y'}`;
    if (insKey === key) { tt.closeInsert(true); return; }
    const ins = tt.insert(rowId, { title: `${title} · ${idxs ? periodTitle(idxs) : year + ' год'}`, onClose: () => { insKey = null; } });
    insKey = key;
    ins.body.replaceChildren(h('p', { class: 'muted' }, 'Загружаю операции…'));
    try {
      const base = { ...query, articleId, ...(extra.counterparty != null ? { counterparty: extra.counterparty } : {}), ...(extra.doc != null ? { doc: extra.doc } : {}) };
      const res = await Promise.all((idxs ? idxs.map((i) => ({ ...base, month: data.months[i] })) : [base]).map((q) => api('/finance/by-articles/ops', { query: q })));
      if (insKey !== key) return; // пока грузилось, закрыли или открыли другую
      let ops = res.flatMap((r) => r.items || []).sort((a, b) => String(a.date).localeCompare(String(b.date)));
      if (extra.counterparty != null && articleId !== 'income') ops = ops.filter((o) => sameName(o.counterparty, /не указан/.test(extra.counterparty) ? '' : extra.counterparty)); // старый сервер фильтра не знает
      ins.body.replaceChildren(ops.length ? h('ul', { class: 'q-list' }, ops.map(opRow)) : h('p', { class: 'hint' }, 'Операций нет.'));
    } catch (e) { if (insKey === key) ins.body.replaceChildren(failBlock(e, () => { insKey = null; showOps(rowId, articleId, extra, idxs, title); }, { cls: 'panel state' })); }
  }

  /** Строка дерева. articleId задан — суммы нажимаются. share — { text, ratio }. */
  function node({ id, label, name, values, total, share, articleId, extra = {}, cls, kids, depth, fmt = num, strong = false }) {
    const can = articleId != null;
    const cells = groups().map((idxs) => {
      if (idxs[0] > curIdx) return null; // будущие периоды — пустые ячейки
      const v = sum(values, idxs);
      return { v: fmt(v, strong), click: can && v !== 0 ? () => showOps(id, articleId, extra, idxs, name || String(label)) : null };
    });
    const t = total == null ? null : { v: fmt(total, true), click: can && Number(total) !== 0 ? () => showOps(id, articleId, extra, null, name || String(label)) : null, title: 'Все операции за год' };
    return { id, label, cls, depth, cells, total: t, share, kids: kids?.length ? kids : undefined, raw: total };
  }

  /** Подстатьи и контрагенты — доля внутри родителя. */
  const inner = (c, parent) => (parent?.total ? { text: pctText((Number(c.total) / Number(parent.total)) * 100), ratio: Number(c.total) / Number(parent.total) } : undefined);
  const outer = (a) => (a.pct != null ? { text: pctText(a.pct), ratio: Number(a.pct) / 100 } : undefined);

  function expenseRows(d) {
    return d.rows.map((a) => node({ id: a.id, label: a.name, name: a.name, values: a.values, total: a.total, share: outer(a), articleId: a.id, strong: true, depth: 2,
      kids: (a.children || []).map((c) => node({ id: c.id, label: c.name, name: `${a.name} → ${c.name}`, values: c.values, total: c.total, share: inner(c, a), articleId: c.id,
        kids: (c.children || []).map((k) => node({ id: `${c.id}|${k.name}`, depth: 3, label: '↳ ' + k.name, name: `${c.name} → ${k.name}`, values: k.values, total: k.total, share: inner(k, c), articleId: c.id, extra: { counterparty: k.name } })) })) }));
  }

  function incomeKids(d) {
    return (d.incomeRows || []).map((cp) => node({ id: cp.id, label: cp.name, name: cp.name, values: cp.values, total: cp.total, share: cp.pct != null ? { text: pctText(cp.pct), ratio: Number(cp.pct) / 100 } : undefined, articleId: 'income', extra: { counterparty: cp.name },
      kids: (cp.children || []).map((o) => node({ id: `${cp.id}|${o.id}`, label: o.name, name: `${cp.name} → ${o.name}`, values: o.values, total: o.total, share: inner(o, cp), articleId: 'income',
        extra: { counterparty: cp.name, doc: o.name } })) }));
  }

  /** Итоговые строки без нажатий: значения по периодам считает вызывающий (a — по периодам). */
  function plain({ id, label, per, total, cls, fmt = num, strong = false }) {
    return { id, label, cls, cells: groups().map((idxs, i) => (idxs[0] > curIdx ? null : { v: fmt(per(idxs, i), strong) })), total: total == null ? null : { v: fmt(total, true) } };
  }

  function paint() {
    const d = data;
    insKey = null;
    const unassigned = d.unassigned && Number(d.unassigned.total) !== 0 ? d.unassigned : null;
    const noOps = !Number(d.head.totals.income) && !Number(d.head.totals.expense) && !unassigned;
    if (noOps) {
      out.replaceChildren(empty({ title: `За ${year} год операций нет`, hint: 'Расходы появятся, когда у оплаченных заявок есть сумма, дата оплаты и наша компания; доходы — когда в заказах вписаны платежи.', action: { label: 'Требуют заполнения', href: '#fill' } }));
      tt = null;
      return;
    }
    const sc = d.scope || {};
    const byPrice = objectMode && sc.contractPrice;
    const inc = Number(d.head.totals.income) || 0, exp = Number(d.head.totals.expense) || 0, res = Number(d.head.totals.profit) || 0;
    const plashes = stats([
      { value: money(inc), label: `доходы за ${year}` }, { value: money(exp), label: `расходы за ${year}` },
      { value: money(res), label: 'финансовый результат', tone: res < 0 ? 'danger' : undefined },
      ...(unassigned?.count ? [{ value: unassigned.count, label: 'без статьи — заполнить →', tone: 'danger', onClick: () => go('fill', { g: 'exp-article' }) }] : [])]);

    const rows = [
      node({ id: 'income', label: 'Доходы', name: 'Доходы', cls: 'grp in', values: d.head.income, total: d.head.totals.income, strong: true, articleId: 'income', kids: incomeKids(d) }),
      node({ id: 'expense', label: 'Расходы', name: 'Расходы', cls: 'grp out', values: d.head.expense, total: d.head.totals.expense, strong: true, articleId: 'expense' }),
      ...expenseRows(d),
    ];
    if (unassigned) rows.push(node({ id: 'none', label: link({ label: 'Без статьи — заполнить →', href: '#fill?g=exp-article', title: 'Открыть «Требуют заполнения»' }), name: 'Без статьи', values: unassigned.values, total: unassigned.total, articleId: 'none', depth: 2 }));
    if (d.unallocated && Number(d.unallocated.total) !== 0) rows.push(plain({ id: 'unallocated', label: 'Не распределено по объекту', cls: 'sub', per: (idxs) => sum(d.unallocated.values, idxs), total: d.unallocated.total }));
    const cum = d.result.cumulative || [];
    rows.push(
      plain({ id: 'result', label: 'Финансовый результат', cls: 'bal end', per: (idxs) => sum(d.head.profit, idxs), total: res, strong: true }),
      plain({ id: 'cumulative', label: h('span', { title: 'Прошлые месяцы плюс этот' }, 'Финансовый результат нарастающим итогом'), cls: 'bal', per: (idxs) => cum[idxs[idxs.length - 1]] ?? 0, total: cum.length ? cum[cum.length - 1] : 0 }),
      plain({ id: 'ratio', label: 'Доходы ÷ расходы', cls: 'bal', per: (idxs) => { const e = sum(d.head.expense, idxs); return e ? sum(d.head.income, idxs) / e : null; }, total: exp ? inc / exp : null, fmt: ratioCell }));

    tt = treeTable({ label: 'Доходы и расходы по статьям', head: 'Статья', open: opened, shareLabel: byPrice ? '% цены' : '%', totalLabel: 'Итого',
      periods: groups().map((idxs) => ({ label: quarters ? `${QUARTER[idxs[0] / 3]} кв.` : MON[idxs[0]], today: curIdx >= 0 && idxs.includes(curIdx) && Number(year) === now.getFullYear() })),
      moreLabel: (rest) => `Ещё ${rest.length} · ${money(rest.reduce((a, r) => a + (Number(r.raw) || 0), 0))}`,
      rows });
    out.replaceChildren(
      objectMode && sc.orderNo ? h('p', { class: 'hint' }, `Объект: заказ № ${sc.orderNo}${sc.title ? ' · ' + sc.title : ''}${byPrice ? ' · цена контракта ' + money(sc.contractPrice) : ''}`) : null,
      plashes,
      inc ? null : h('p', { class: 'hint' }, noIncomeText || 'Поступлений нет.', ' ', link({ label: 'Требуют заполнения', href: '#fill' })),
      tt.el,
      h('p', { class: 'hint' }, `Только факт — по сегодня включительно. ▸ раскрывает строку, нажмите на сумму — операции появятся под ней. Процент — ${byPrice ? 'доля от цены контракта' : 'у статьи доля от всех расходов года, у подстатьи — доля внутри статьи'}. Строки с нулём за год не показываются.`));
  }

  async function load() {
    out.replaceChildren(h('p', { class: 'muted' }, 'Загружаю…'));
    try {
      await paintBar();
      if (objectMode && !order) { out.replaceChildren(h('p', { class: 'hint' }, 'Выберите объект (заказ) — покажем его доходы и расходы по статьям.')); return; }
      query = { year, org, mode: objectMode ? 'object' : 'company', ...(objectMode ? { salesOrderId: order } : {}) };
      data = await api('/finance/by-articles', { query });
      paint();
    } catch (e) { out.replaceChildren(failBlock(e, load, { cls: 'panel state' })); }
  }
  load();
  return el;
}
