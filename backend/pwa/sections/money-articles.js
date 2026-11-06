import { api } from '../core/api.js';
import { h } from '../core/dom.js';
import { money } from '../core/format.js';
import { patch } from '../core/router.js';
import { button, iconButton, link, segmented, select, enhanceSelect, failBlock, table, toolbar } from '../ui/kit/index.js';
import { orderChoices } from './expenses.js';

/**
 * «Деньги → По статьям» (C027): таблица как у директора — статьи расходов по месяцам, статья раскрывается в подстатьи.
 * Сервер: GET /finance/by-articles?year&org&mode&salesOrderId, клик по сумме — GET /finance/by-articles/ops (месяц, статья).
 * Только факт. Таблица — тот же `table.cal`, что у календаря. opRow передаёт money.js (строка операции).
 */
const MON = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'];
const opened = new Set(); // раскрытые статьи — помним между перерисовками и сменой года
const num = (v, strong) => {
  const n = Number(v) || 0;
  return n === 0 ? h('span', { class: 'num muted' }, '—') : h('span', { class: 'num' + (n < 0 ? ' neg' : '') + (strong ? ' strong' : '') }, money(n).replace(' ₽', ''));
};
const pctText = (p) => (p == null ? '' : String(Math.round(Number(p) * 10) / 10).replace('.', ',') + '%');
const ratioCell = (v) => (v == null ? h('span', { class: 'num muted' }, '—') : h('span', { class: 'num' }, String(Math.round(Number(v) * 100) / 100).replace('.', ',')));

export function articlesView({ year, org, mode, order, opRow }) {
  const objectMode = mode === 'object';
  const el = h('div');
  const bar = toolbar();
  const out = h('div');
  const opsBox = h('div', { class: 'panel m-ops', hidden: true });
  el.append(bar, out, opsBox);
  let data = null;
  let query = {};

  const paintBar = async () => {
    const kids = [segmented({ cls: 'seg', label: 'Что показать', items: [{ key: 'company', label: 'Все заказы' }, { key: 'object', label: 'Один заказ' }], value: objectMode ? 'object' : 'company',
      onChange: (k) => patch({ mode: k === 'object' ? 'object' : undefined, order: undefined }) }).el];
    if (objectMode) {
      const sel = select({ options: await orderChoices('Выберите объект'), value: order || '', label: 'Объект (заказ)', onChange: (v) => patch({ order: v || undefined }) });
      kids.push(sel);
      enhanceSelect(sel, { force: true });
    }
    kids.push(button({ label: 'Раскрыть всё', kind: 'ghost', size: 'S', onClick: () => { (data?.rows || []).forEach((r) => { if (r.children?.length) opened.add(r.id); r.children?.forEach((c) => { if (c.children?.length) opened.add(c.id); }); }); paint(); } }),
      button({ label: 'Свернуть всё', kind: 'ghost', size: 'S', onClick: () => { opened.clear(); paint(); } }));
    bar.replaceChildren(...kids);
  };

  async function showOps(articleId, values, idx, title, counterparty) {
    const months = idx >= 0 ? [data.months[idx]] : data.months.filter((_, i) => Number(values[i]) !== 0);
    const when = idx >= 0 ? `${MON[Number(data.months[idx].slice(5)) - 1]} ${year}` : `${year} год`;
    opsBox.hidden = false;
    opsBox.replaceChildren(h('p', { class: 'muted' }, 'Загружаю операции…'));
    opsBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    try {
      const res = await Promise.all(months.map((m) => api('/finance/by-articles/ops', { query: { ...query, articleId, month: m } })));
      let ops = res.flatMap((r) => r.items || []).sort((a, b) => String(a.date).localeCompare(String(b.date)));
      if (counterparty) ops = ops.filter((o) => (o.counterparty || '') === counterparty);
      opsBox.replaceChildren(
        h('div', { class: 'q-head' }, h('h3', null, `${title} · ${when}`), button({ label: 'Скрыть', kind: 'ghost', size: 'S', onClick: () => { opsBox.hidden = true; } })),
        ops.length ? h('ul', { class: 'q-list' }, ops.map(opRow)) : h('p', { class: 'hint' }, 'Операций нет.'));
    } catch (e) { opsBox.replaceChildren(failBlock(e, () => showOps(articleId, values, idx, title, counterparty), { cls: 'panel state' })); }
  }

  /** Строка таблицы. articleId задан — суммы кликабельны. label — узел или текст. */
  function tr({ cls, label, name, values, total, pct, articleId, counterparty, fmt = num, strong = false }) {
    const can = (v) => articleId != null && Number(v) !== 0;
    const cells = values.map((v, i) => h('td', { class: 'day' + (can(v) ? ' click' : ''), title: can(v) ? 'Операции' : undefined, onclick: can(v) ? () => showOps(articleId, values, i, name, counterparty) : undefined }, fmt(v, strong)));
    const totalCell = total == null ? h('td', { class: 'tot' })
      : h('td', { class: 'tot' + (can(total) ? ' click' : ''), title: can(total) ? 'Все операции за год' : undefined, onclick: can(total) ? () => showOps(articleId, values, -1, name, counterparty) : undefined }, fmt(total, true));
    return h('tr', { class: cls }, h('td', { class: 'sticky' }, label), ...cells, totalCell, h('td', { class: 'tot' }, pctText(pct)));
  }

  const toggler = (row, title, pad = '') => {
    const isOpen = opened.has(row.id);
    const flip = () => { if (isOpen) opened.delete(row.id); else opened.add(row.id); paint(); };
    return h('span', null, pad, iconButton({ icon: isOpen ? '▾' : '▸', label: isOpen ? 'Свернуть' : 'Раскрыть', size: 'S', onClick: flip }), ' ', link({ label: title, onClick: flip }));
  };

  function paint() {
    const d = data;
    const rows = [
      tr({ cls: 'grp in', label: 'Доходы', values: d.head.income, total: d.head.totals.income, strong: true, articleId: 'income' }),
      tr({ cls: 'grp out', label: 'Расходы', values: d.head.expense, total: d.head.totals.expense, strong: true, articleId: 'expense' }),
      tr({ cls: 'res', label: 'Прибыль', values: d.head.profit, total: d.head.totals.profit, strong: true }),
    ];
    for (const a of d.rows) {
      const hasKids = !!a.children?.length;
      rows.push(tr({ label: hasKids ? toggler(a, a.name) : a.name, name: a.name, values: a.values, total: a.total, pct: a.pct, articleId: a.id, strong: true }));
      if (!hasKids || !opened.has(a.id)) continue;
      for (const c of a.children) {
        const hasDeep = !!c.children?.length;
        rows.push(tr({ label: hasDeep ? toggler(c, c.name, '  ') : '  ' + c.name, name: `${a.name} → ${c.name}`, values: c.values, total: c.total, pct: c.pct, articleId: c.id }));
        if (hasDeep && opened.has(c.id)) for (const k of c.children) rows.push(tr({ label: '    ↳ ' + k.name, name: `${c.name} → ${k.name}`, values: k.values, total: k.total, pct: k.pct, articleId: c.id, counterparty: k.name }));
      }
    }
    if (d.unassigned && Number(d.unassigned.total) !== 0) {
      rows.push(tr({ label: link({ label: 'Без статьи — заполнить →', href: '#fill?g=exp-article', title: 'Открыть «Требуют заполнения»' }), name: 'Без статьи', values: d.unassigned.values, total: d.unassigned.total, articleId: 'none' }));
    }
    if (d.unallocated && Number(d.unallocated.total) !== 0) rows.push(tr({ cls: 'sub', label: 'Не распределено по объекту', values: d.unallocated.values, total: d.unallocated.total }));
    const last = (a) => (a?.length ? a[a.length - 1] : 0);
    rows.push(
      tr({ cls: 'bal end', label: 'Финансовый результат', values: d.result.values, total: d.head.totals.profit, strong: true }),
      tr({ cls: 'bal', label: 'Нарастающим итогом', values: d.result.cumulative, total: last(d.result.cumulative) }),
      tr({ cls: 'bal', label: 'Доходы ÷ расходы', values: d.result.ratio, total: null, fmt: ratioCell }));
    const sc = d.scope || {};
    const byPrice = objectMode && sc.contractPrice;
    out.replaceChildren(
      objectMode && sc.orderNo ? h('p', { class: 'hint' }, `Объект: заказ № ${sc.orderNo}${sc.title ? ' · ' + sc.title : ''}${byPrice ? ' · цена контракта ' + money(sc.contractPrice) : ''}`) : null,
      table({ cls: 'cal', label: 'Расходы по статьям',
        columns: [{ label: 'Статья', cls: 'sticky' }, ...d.months.map((m) => ({ label: MON[Number(m.slice(5)) - 1], cls: 'day' })), { label: 'Итого', cls: 'tot' }, { label: '%', cls: 'tot' }],
        rows }),
      h('p', { class: 'hint' }, `Только факт — по сегодня включительно. ▸ раскрывает статью, нажмите на сумму — увидите операции. Процент — ${byPrice ? 'доля от цены контракта' : 'доля от всех расходов года'}. Строки с нулём за год не показываются.`));
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
