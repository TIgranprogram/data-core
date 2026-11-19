import { api } from '../core/api.js';
import { h } from '../core/dom.js';
import { money } from '../core/format.js';
import { go, patch } from '../core/router.js';
import { actions, button, empty, link, segmented, failBlock, stats, toolbar, treeTable } from '../ui/kit/index.js';

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

export function articlesView({ year, org, mode, order, filters = {}, incomeMode, opRow, noIncomeText }) {
  const objectMode = mode === 'object' && !!(filters.salesOrderId || order);
  const el = h('div');
  const bar = toolbar();
  const out = h('div');
  el.append(bar, out);
  let data = null;
  let query = {};
  let tt = null; // treeTable текущей перерисовки
  let quarters = store.get(PERIOD_KEY) === 'quarters';

  const monthKeys = () => data?.months || MON.map((_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
  const groups = () => {
    const grouped = new Map();
    monthKeys().forEach((key, index) => { if (key > new Date().toISOString().slice(0, 7)) return; const bucket = quarters ? `${key.slice(0, 4)}-${Math.floor((Number(key.slice(5, 7)) - 1) / 3)}` : key; grouped.set(bucket, [...(grouped.get(bucket) || []), index]); });
    return [...grouped.values()];
  };
  const periodTitle = idxs => { const key = monthKeys()[idxs[0]]; return quarters ? `${QUARTER[Math.floor((Number(key.slice(5, 7)) - 1) / 3)]} квартал ${key.slice(0, 4)}` : `${MON_FULL[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`; };

  const paintBar = async () => {
    const kids = [];
    kids.push(segmented({ label: 'Доходы в таблице', value: incomeMode === 'customers' ? 'customers' : 'articles', items: [{ key: 'articles', label: 'Доходные статьи' }, { key: 'customers', label: 'Заказчики и заказы' }], onChange: value => patch({ incomeMode: value === 'customers' ? value : undefined }) }).el);
    kids.push(segmented({ fit: true, label: 'Период таблицы', items: [{ key: 'months', label: 'Месяцы' }, { key: 'quarters', label: 'Кварталы' }], value: quarters ? 'quarters' : 'months',
      onChange: (k) => { quarters = k === 'quarters'; store.set(PERIOD_KEY, k); if (data) paint(); } }).el,
    actions( // пара кнопок вместе: на телефоне не разъезжается по двум строкам (дизайнер 15.11)
      button({ label: 'Раскрыть всё', kind: 'ghost', size: 'S', onClick: () => tt?.expandAll() }),
      button({ label: 'Свернуть всё', kind: 'ghost', size: 'S', onClick: () => tt?.collapseAll() })));
    bar.replaceChildren(...kids);
  };

  /** Операции под строкой: idxs — месяцы (null — весь год); extra — counterparty / doc. */
  async function showOps(rowId, articleId, extra, idxs) {
    const months = idxs?.map(index => monthKeys()[index]);
    const from = months ? months[0] + '-01' : filters.from || `${year}-01-01`;
    const last = months?.at(-1);
    const to = last ? new Date(Date.UTC(Number(last.slice(0, 4)), Number(last.slice(5, 7)), 0)).toISOString().slice(0, 10) : filters.to || `${year}-12-31`;
    patch({ view: 'operations', page: undefined, from: filters.from && filters.from > from ? filters.from : from, to: filters.to && filters.to < to ? filters.to : to,
      ...(['income', 'expense'].includes(articleId) ? { type: articleId } : { articleId }), ...(extra.counterparty != null ? { counterpartyName: extra.counterparty || undefined } : {}), ...(extra.salesOrderId ? { salesOrderId: extra.salesOrderId } : {}) });
  }

  /** Строка дерева. articleId задан — суммы нажимаются. share — { text, ratio }. */
  function node({ id, label, name, values, total, share, articleId, extra = {}, cls, kids, depth, fmt = num, strong = false }) {
    const can = articleId != null;
    const cells = groups().map((idxs) => {
      const v = sum(values, idxs);
      return { v: fmt(v, strong), click: can && v !== 0 ? () => showOps(id, articleId, extra, idxs, name || String(label)) : null };
    });
    const t = total == null ? null : { v: fmt(total, true), click: can && Number(total) !== 0 ? () => showOps(id, articleId, extra, null, name || String(label)) : null, title: 'Все операции за год' };
    return { id, label, cls, depth, cells, total: t, share, kids: kids?.length ? kids : undefined, raw: total };
  }

  /** Подстатьи и контрагенты — доля внутри родителя. */
  const inner = (c, parent) => (parent?.total ? { text: pctText((Number(c.total) / Number(parent.total)) * 100), ratio: Number(c.total) / Number(parent.total) } : undefined);
  const outer = (a) => (a.pct != null ? { text: pctText(a.pct), ratio: Number(a.pct) / 100 } : undefined);

  function articleRows(rows) {
    const build = (article, parent) => node({ id: article.id, label: article.name, name: article.path?.map?.(part => typeof part === 'string' ? part : part.name).join(' → ') || article.name, values: article.values, total: article.total, share: parent ? inner(article, parent) : outer(article), articleId: article.id, strong: !parent, depth: parent ? undefined : 2,
      kids: (article.children || []).map(child => child.id ? build(child, article) : node({ id: `${article.id}|${child.name}`, label: child.name, name: child.name, values: child.values, total: child.total, share: inner(child, article), articleId: article.id, extra: { counterparty: child.name } })) });
    return (rows || []).map(row => build(row));
  }
  function expenseRows(d) { return articleRows(d.articleRows ? d.articleRows.filter(row => row.type === 'expense') : d.rows); }

  function incomeKids(d) {
    return (d.incomeRows || []).map((cp) => node({ id: cp.id, label: cp.name, name: cp.name, values: cp.values, total: cp.total, share: cp.pct != null ? { text: pctText(cp.pct), ratio: Number(cp.pct) / 100 } : undefined, articleId: 'income', extra: { counterparty: cp.name },
      kids: (cp.children || []).map((o) => node({ id: `${cp.id}|${o.id}`, label: o.name, name: `${cp.name} → ${o.name}`, values: o.values, total: o.total, share: inner(o, cp), articleId: 'income',
        extra: { counterparty: cp.name, salesOrderId: o.id } })) }));
  }

  /** Итоговые строки без нажатий: значения по периодам считает вызывающий (a — по периодам). */
  function plain({ id, label, per, total, cls, fmt = num, strong = false }) {
    return { id, label, cls, cells: groups().map((idxs, i) => ({ v: fmt(per(idxs, i), strong) })), total: total == null ? null : { v: fmt(total, true) } };
  }

  function paint() {
    const d = data;
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
      { value: money(inc), label: 'Поступления за выбранный период' }, { value: money(exp), label: 'Выплаты за выбранный период' },
      { value: money(res), label: 'Денежный результат', tone: res < 0 ? 'danger' : undefined },
      ...(unassigned?.count ? [{ value: unassigned.count, label: 'без статьи — заполнить →', tone: 'danger', onClick: () => go('fill', { g: 'exp-article' }) }] : [])]);

    const rows = [
      node({ id: 'income', label: 'Доходы', name: 'Доходы', cls: 'grp in', values: d.head.income, total: d.head.totals.income, strong: true, articleId: 'income', kids: incomeMode === 'customers' ? incomeKids(d) : articleRows((d.articleRows || []).filter(row => row.type === 'income')) }),
      node({ id: 'expense', label: 'Расходы', name: 'Расходы', cls: 'grp out', values: d.head.expense, total: d.head.totals.expense, strong: true, articleId: 'expense' }),
      ...expenseRows(d),
    ];
    if (unassigned) rows.push(node({ id: 'none', label: link({ label: 'Без статьи — заполнить →', href: '#fill?g=exp-article', title: 'Открыть «Требуют заполнения»' }), name: 'Без статьи', values: unassigned.values, total: unassigned.total, articleId: 'none', depth: 2 }));
    if (d.unallocated && Number(d.unallocated.total) !== 0) rows.push(plain({ id: 'unallocated', label: 'Не распределено по объекту', cls: 'sub', per: (idxs) => sum(d.unallocated.values, idxs), total: d.unallocated.total }));
    const cum = d.result.cumulative || [];
    rows.push(
      plain({ id: 'result', label: 'Денежный результат', cls: 'bal end', per: (idxs) => sum(d.head.profit, idxs), total: res, strong: true }),
      plain({ id: 'cumulative', label: h('span', { title: 'Прошлые месяцы плюс этот' }, 'Денежный результат нарастающим итогом'), cls: 'bal', per: (idxs) => cum[idxs[idxs.length - 1]] ?? 0, total: cum.length ? cum[cum.length - 1] : 0 }),
      plain({ id: 'ratio', label: 'Доходы ÷ расходы', cls: 'bal', per: (idxs) => { const e = sum(d.head.expense, idxs); return e ? sum(d.head.income, idxs) / e : null; }, total: exp ? inc / exp : null, fmt: ratioCell }));

    tt = treeTable({ label: 'Доходы и расходы по статьям', head: 'Статья', open: opened, shareLabel: byPrice ? '% цены' : '%', totalLabel: 'Итого',
      periods: groups().map((idxs) => ({ label: periodTitle(idxs), today: idxs.some(index => monthKeys()[index] === new Date().toISOString().slice(0, 7)) })),
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
      query = { year, org, ...filters, mode: objectMode ? 'object' : 'company', ...(objectMode ? { salesOrderId: filters.salesOrderId || order } : {}) };
      data = await api('/finance/by-articles', { query });
      paint();
    } catch (e) { out.replaceChildren(failBlock(e, load, { cls: 'panel state' })); }
  }
  load();
  return el;
}
