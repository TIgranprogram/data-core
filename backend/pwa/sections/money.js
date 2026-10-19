import { api, session } from '../core/api.js';
import { h } from '../core/dom.js';
import { date, money } from '../core/format.js';
import { patch } from '../core/router.js';

/**
 * «Деньги» (PRODUCT §5, TASKS Ф.6): платёжный календарь СИЮ/ССЮ по дням, сводка по месяцам, «требуют заполнения».
 * Всё считается на сервере (/api/finance) из заявок (расходы) и заказов (доходы). Состояние — в адресе:
 * #money?tab=calendar|summary|fill&month=2026-10&org=all|СИЮ|ССЮ. Клик по сумме дня — операции дня;
 * клик по операции — её карточка справа (страница не меняется).
 */
const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
const WD = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const cur = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
const lastDay = (m) => { const [y, mo] = m.split('-').map(Number); return new Date(Date.UTC(y, mo, 0)).getUTCDate(); };
const shiftMonth = (m, n) => { const [y, mo] = m.split('-').map(Number); const d = new Date(Date.UTC(y, mo - 1 + n, 1)); return d.toISOString().slice(0, 7); };
const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* */ } } };
/** Сумма для ячейки: ноль не показываем, минус — красным. */
const cell = (v, opts = {}) => (v ? h('span', { class: 'num' + (v < 0 ? ' neg' : '') + (opts.strong ? ' strong' : '') }, money(v).replace(' ₽', '')) : '');

export function mountMoney(params) {
  let P = { ...params };
  const tab = () => P.tab || 'calendar';
  const month = () => (/^\d{4}-\d{2}$/.test(P.month || '') ? P.month : cur());
  const org = () => P.org || 'all';

  // ---------- Шапка: вкладки, месяц, компания, начальный остаток ----------
  const tabs = h('div', { class: 'seg', role: 'tablist' });
  const monthLabel = h('span', { class: 'm-label' });
  const orgSeg = h('div', { class: 'seg' });
  const opening = h('input', { class: 'm-open', inputmode: 'decimal', placeholder: '0', 'aria-label': 'Остаток на начало месяца', title: 'Остаток денег на начало месяца (запоминается в этом браузере)' });
  opening.addEventListener('change', () => { store.set('dc-opening-' + month() + '-' + org(), opening.value.trim()); load(); });
  const controls = h('div', { class: 'm-controls' },
    h('div', { class: 'm-month' },
      h('button', { class: 'btn btn-ghost btn-icon', type: 'button', title: 'Предыдущий месяц', onclick: () => patch({ month: shiftMonth(month(), -1) }) }, '‹'),
      monthLabel,
      h('button', { class: 'btn btn-ghost btn-icon', type: 'button', title: 'Следующий месяц', onclick: () => patch({ month: shiftMonth(month(), 1) }) }, '›')),
    orgSeg,
    h('label', { class: 'date-f' }, h('span', null, 'остаток на 1-е'), opening));
  const body = h('div', { class: 'm-body' });
  const el = h('div', { class: 'money' },
    h('div', { class: 'page-head' }, h('h1', null, 'Деньги'), h('span', { class: 'spacer' }), tabs),
    controls, body);

  function renderChrome(companies) {
    tabs.replaceChildren(...[['calendar', 'Платёжный календарь'], ['summary', 'Сводка'], ['fill', 'Требуют заполнения']].map(([k, l]) =>
      h('button', { type: 'button', class: tab() === k ? 'active' : '', onclick: () => patch({ tab: k === 'calendar' ? undefined : k }) }, l)));
    const [y, m] = month().split('-').map(Number);
    monthLabel.textContent = `${MONTHS[m - 1][0].toUpperCase()}${MONTHS[m - 1].slice(1)} ${y}`;
    orgSeg.replaceChildren(...['all', ...(companies || ['СИЮ', 'ССЮ'])].map((c) =>
      h('button', { type: 'button', class: org() === c ? 'active' : '', onclick: () => patch({ org: c === 'all' ? undefined : c }) }, c === 'all' ? 'Все' : c)));
    opening.value = store.get('dc-opening-' + month() + '-' + org()) || '';
    controls.hidden = tab() === 'fill';
    opening.parentElement.hidden = tab() !== 'calendar';
  }

  // ---------- Календарь ----------
  function calendar(c) {
    const days = c.days;
    const sel = { date: null };
    const opsBox = h('div', { class: 'm-ops', hidden: true });
    const head = h('tr', null, h('th', { class: 'sticky' }, 'Показатель'), h('th', { class: 'tot' }, 'Итого'),
      days.map((d) => h('th', { class: 'day' + (d.weekday === 0 || d.weekday === 6 ? ' wkend' : '') + (d.date === new Date().toISOString().slice(0, 10) ? ' today' : '') },
        h('b', null, String(Number(d.date.slice(8)))), h('span', null, WD[d.weekday]))));
    const row = (label, cls, total, get, clickable) => h('tr', { class: cls },
      h('th', { class: 'sticky' }, label), h('td', { class: 'tot' }, total),
      days.map((d) => {
        const v = get(d);
        const can = clickable && d.ops.length && v;
        return h('td', { class: 'day' + (d.weekday === 0 || d.weekday === 6 ? ' wkend' : '') + (can ? ' click' : ''), onclick: can ? () => showOps(d) : undefined, title: can ? 'Операции дня' : undefined }, v);
      }));
    const cos = c.companies;
    const rows = [
      row('Остаток на начало дня', 'bal', cell(c.totals.opening), (d) => cell(d.opening)),
      row('Поступления', 'grp in', cell(c.totals.income, { strong: true }), (d) => cell(d.income, { strong: true }), true),
      ...cos.map((co) => row(co, 'sub', cell(c.totals.incomeBy[co]), (d) => cell(d.incomeBy[co]), true)),
      row('Выплаты', 'grp out', cell(c.totals.expense, { strong: true }), (d) => cell(d.expense, { strong: true }), true),
      ...cos.map((co) => row(co, 'sub', cell(c.totals.expenseBy[co]), (d) => cell(d.expenseBy[co]), true)),
      row('Остаток на конец дня', 'bal end', cell(c.totals.closing, { strong: true }), (d) => cell(d.closing)),
    ];
    function showOps(d) {
      sel.date = d.date;
      const dd = new Date(d.date + 'T00:00:00Z');
      opsBox.hidden = false;
      opsBox.replaceChildren(
        h('div', { class: 'q-head' }, h('h3', null, `Операции ${dd.getUTCDate()} ${MONTHS[dd.getUTCMonth()].replace(/ь$/, 'я').replace(/й$/, 'я').replace(/т$/, 'та')}`),
          h('button', { class: 'btn btn-ghost btn-sm q-link', type: 'button', onclick: () => { opsBox.hidden = true; } }, 'Скрыть')),
        h('ul', { class: 'q-list' }, d.ops.map((o) => h('li', { class: 'q-row', tabindex: '0', onclick: () => patch({ of: o.type === 'income' ? 'orders' : 'requests', open: o.id }) },
          h('div', { class: 'q-main' }, h('div', { class: 'q-title' }, o.title), h('div', { class: 'q-sub' }, [o.type === 'income' ? 'поступление' : 'выплата', o.company, o.doc, o.counterparty, o.category].filter(Boolean).join(' · '))),
          h('div', { class: 'q-side' }, h('span', { class: 'num ' + (o.type === 'income' ? 'pos' : 'neg') }, (o.type === 'income' ? '+' : '−') + money(o.amount)))))));
      opsBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    const t = c.totals;
    const kpi = (label, v, cls = '') => h('div', { class: 'sum-item static ' + cls }, h('span', { class: 'sum-v' + (v < 0 ? ' neg' : '') }, money(v)), h('span', { class: 'sum-l' }, label));
    return [
      h('div', { class: 'summary' }, kpi('остаток на начало', t.opening), kpi('поступления', t.income), kpi('выплаты', t.expense), kpi('остаток на конец', t.closing),
        c.needsFill.total ? h('button', { class: 'sum-item attn', type: 'button', onclick: () => patch({ tab: 'fill' }) }, h('span', { class: 'sum-v' }, String(c.needsFill.total)), h('span', { class: 'sum-l' }, 'не попали в расчёт →')) : null),
      h('div', { class: 'panel cal-wrap' }, h('table', { class: 'cal' }, h('thead', null, head), h('tbody', null, rows))),
      h('p', { class: 'hint' }, 'Расходы — заявки с датой счёта, суммой и нашей компанией (по дате счёта). Поступления — строки заказов (по дате оплаты, иначе отгрузки). Нажмите на сумму дня — увидите операции.'),
      h('div', { class: 'panel' }, opsBox),
    ];
  }

  // ---------- Сводка ----------
  function summary(s) {
    const cos = s.companies;
    const headRow = h('tr', null, h('th', null, 'Месяц'), cos.flatMap((c) => [h('th', { class: 'right' }, `${c}: доход`), h('th', { class: 'right' }, 'расход'), h('th', { class: 'right' }, 'прибыль')]));
    const line = (label, by, cls) => h('tr', { class: cls || '' }, h('td', null, label), cos.flatMap((c) => [
      h('td', { class: 'right' }, cell(by[c].income)), h('td', { class: 'right' }, cell(by[c].expense)), h('td', { class: 'right' }, cell(by[c].profit, { strong: true }))]));
    const name = (m) => { const [y, mo] = m.split('-').map(Number); return `${MONTHS[mo - 1]} ${y}`; };
    // Пустые месяцы до первого с данными не показываем (год начался раньше, чем учёт)
    const has = (m) => cos.some((c) => m.byCompany[c].income || m.byCompany[c].expense);
    const first = s.months.findIndex(has);
    const months = first < 0 ? s.months.slice(-1) : s.months.slice(first);
    const cats = h('tr', null, h('th', null, 'Категория'), cos.map((c) => h('th', { class: 'right' }, c)), h('th', { class: 'right' }, 'Всего'));
    return [
      h('div', { class: 'panel' }, h('div', { class: 'q-head' }, h('h3', null, 'Доходы и расходы по месяцам')),
        h('div', { class: 'table-wrap' }, h('table', { class: 'list sum-tbl' }, h('thead', null, headRow), h('tbody', null, months.map((m) => line(name(m.month), m.byCompany)), line('Итого', s.total, 'total'))))),
      h('div', { class: 'panel', style: { marginTop: '16px' } }, h('div', { class: 'q-head' }, h('h3', null, 'Расходы по категориям')),
        h('div', { class: 'table-wrap' }, h('table', { class: 'list sum-tbl' }, h('thead', null, cats),
          h('tbody', null, s.expensesByCategory.length ? s.expensesByCategory.map((x) => h('tr', null, h('td', null, x.category), cos.map((c) => h('td', { class: 'right' }, cell(x.byCompany[c]))), h('td', { class: 'right' }, cell(x.total, { strong: true }))))
            : h('tr', null, h('td', { colspan: cos.length + 2, class: 'muted' }, 'Расходов за период нет')))))),
    ];
  }

  // ---------- Требуют заполнения ----------
  function fill(nf) {
    if (!nf.items.length) return [h('div', { class: 'panel state' }, 'Всё заполнено — все заявки и заказы попадают в расчёт 👍')];
    return [h('div', { class: 'panel queue' },
      h('div', { class: 'q-head' }, h('div', null, h('h3', null, 'Не попадают в календарь ', h('span', { class: 'q-n' }, String(nf.total))),
        h('div', { class: 'q-hint' }, 'Чего не хватает — указано в строке. Нажмите, впишите в карточке («Изменить») — запись сразу попадёт в расчёт.'))),
      h('ul', { class: 'q-list' }, nf.items.map((x) => h('li', { class: 'q-row', tabindex: '0', onclick: () => patch({ of: x.type === 'income' ? 'orders' : 'requests', open: x.id }) },
        h('div', { class: 'q-main' }, h('div', { class: 'q-title' }, x.title), h('div', { class: 'q-sub' }, [x.type === 'income' ? 'заказ (доход)' : 'заявка (расход)', x.doc, x.date ? date(x.date) : ''].filter(Boolean).join(' · '))),
        h('div', { class: 'q-side' }, h('span', { class: 'badge warn' }, 'нет: ' + x.missing.join(', ')))))))];
  }

  let seq = 0;
  async function load() {
    const my = ++seq;
    renderChrome();
    el.classList.add('loading');
    try {
      const m = month();
      const q = { from: `${m}-01`, to: `${m}-${String(lastDay(m)).padStart(2, '0')}`, org: org() };
      let content;
      if (tab() === 'fill') content = fill(await api('/finance/needs-fill'));
      else if (tab() === 'summary') {
        const y = m.slice(0, 4);
        const s = await api('/finance/summary', { query: { from: `${y}-01-01`, to: `${y}-12-31`, org: org() } });
        if (my !== seq) return;
        renderChrome(s.companies);
        content = summary(s);
      } else {
        const c = await api('/finance/cashflow', { query: { ...q, opening: opening.value.trim().replace(',', '.') || 0 } });
        if (my !== seq) return;
        renderChrome(c.companies);
        content = calendar(c);
      }
      if (my !== seq) return;
      body.replaceChildren(...content);
    } catch (e) {
      if (my === seq) body.replaceChildren(h('div', { class: 'panel state' }, 'Не удалось загрузить: ' + e.message, h('div', null, h('button', { class: 'btn', type: 'button', onclick: load }, 'Повторить'))));
    } finally { if (my === seq) el.classList.remove('loading'); }
  }
  load();

  return {
    el,
    reload: load,
    /** Смена вкладки/месяца/компании — без пересоздания экрана; открытая карточка — без перезагрузки данных. */
    update(next) {
      const changed = ['tab', 'month', 'org'].some((k) => (next[k] || '') !== (P[k] || ''));
      P = { ...next };
      if (changed) load();
    },
    canEdit: session.canEdit,
  };
}
