import { api, session } from '../core/api.js';
import { h } from '../core/dom.js';
import { money } from '../core/format.js';
import { go, patch } from '../core/router.js';

/**
 * «Деньги» (PRODUCT §5, TASKS Ф.6): платёжный календарь СИЮ/ССЮ по дням, сводка по месяцам, «требуют заполнения».
 * Всё считается на сервере (/api/finance) из заявок (расходы) и заказов (доходы). Состояние — в адресе:
 * #money?tab=calendar|summary&month=2026-10&org=all|СИЮ|ССЮ. Клик по сумме дня — операции дня;
 * клик по операции — её карточка справа (страница не меняется).
 * Решение 2026-10-20: деньги — только факт по сегодня включительно; будущее (план, прогноз) — отдельный раздел позже.
 * Пока остаток на 1-е не введён, показываем не «остаток», а «итог с 1-го числа» — без тревожного красного.
 */
const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
/** Пустые значения в долях «Куда / На что / Кому» → группа «Требуют заполнения» (sections/fill.js). */
const UNSET = { 'Не указано': 'exp-cost', 'Без категории': 'exp-category', 'Поставщик не указан': 'exp-supplier' };
const WD = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const cur = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
const lastDay = (m) => { const [y, mo] = m.split('-').map(Number); return new Date(Date.UTC(y, mo, 0)).getUTCDate(); };
const shiftMonth = (m, n) => { const [y, mo] = m.split('-').map(Number); const d = new Date(Date.UTC(y, mo - 1 + n, 1)); return d.toISOString().slice(0, 7); };
const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* */ } } };
/** Сумма для ячейки: ноль не показываем, минус — красным. */
const cell = (v, opts = {}) => (v ? h('span', { class: 'num' + (v < 0 && !opts.calm ? ' neg' : '') + (opts.strong ? ' strong' : '') }, money(v).replace(' ₽', '')) : '');
const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const hasOpening = (el) => el.value.trim() !== '' && Number(el.value.trim().replace(',', '.')) !== 0;

export function mountMoney(params) {
  let P = { ...params };
  const tab = () => P.tab || 'calendar';
  const month = () => (/^\d{4}-\d{2}$/.test(P.month || '') ? P.month : cur());
  const org = () => P.org || 'all';

  // ---------- Шапка: вкладки, месяц, компания, начальный остаток ----------
  const tabs = h('div', { class: 'seg', role: 'tablist' });
  const monthLabel = h('span', { class: 'm-label' });
  const orgSeg = h('div', { class: 'seg' });
  const opening = h('input', { class: 'm-open', inputmode: 'decimal', placeholder: 'не знаю', 'aria-label': 'Остаток на начало месяца', title: 'Остаток денег на начало месяца (запоминается в этом браузере)' });
  opening.addEventListener('change', () => { store.set('dc-opening-' + month() + '-' + org(), opening.value.trim()); load(); });
  const nextBtn = h('button', { class: 'btn btn-ghost btn-icon', type: 'button', title: 'Следующий месяц', onclick: () => patch({ month: shiftMonth(month(), 1) }) }, '›');
  const controls = h('div', { class: 'm-controls' },
    h('div', { class: 'm-month' },
      h('button', { class: 'btn btn-ghost btn-icon', type: 'button', title: 'Предыдущий месяц', onclick: () => patch({ month: shiftMonth(month(), -1) }) }, '‹'),
      monthLabel,
      nextBtn),
    orgSeg,
    h('label', { class: 'date-f' }, h('span', null, 'остаток денег на 1-е'), opening));
  const body = h('div', { class: 'm-body' });
  const el = h('div', { class: 'money' },
    h('div', { class: 'page-head' }, h('h1', null, 'Деньги'), h('span', { class: 'spacer' }), tabs),
    controls, body);

  function renderChrome(companies) {
    tabs.replaceChildren(...[['calendar', 'Платёжный календарь'], ['summary', 'Сводка'], ['fill', 'Требуют заполнения']].map(([k, l]) =>
      h('button', { type: 'button', class: tab() === k ? 'active' : '', onclick: () => (k === 'fill' ? go('fill') : patch({ tab: k === 'calendar' ? undefined : k })) }, l)));
    const [y, m] = month().split('-').map(Number);
    monthLabel.textContent = `${MONTHS[m - 1][0].toUpperCase()}${MONTHS[m - 1].slice(1)} ${y}`;
    orgSeg.replaceChildren(...['all', ...(companies || ['СИЮ', 'ССЮ'])].map((c) =>
      h('button', { type: 'button', class: org() === c ? 'active' : '', onclick: () => patch({ org: c === 'all' ? undefined : c }) }, c === 'all' ? 'Все' : c)));
    opening.value = store.get('dc-opening-' + month() + '-' + org()) || '';
    controls.hidden = tab() === 'fill';
    nextBtn.disabled = month() >= cur(); // будущее — отдельный прогноз
    opening.parentElement.hidden = tab() !== 'calendar';
  }

  // ---------- Календарь ----------
  function calendar(c) {
    const days = c.days;
    const sel = { date: null };
    const opsBox = h('div', { class: 'm-ops', hidden: true });
    const head = h('tr', null, h('th', { class: 'sticky' }, 'Показатель'), h('th', { class: 'tot', title: 'Total — итог за выбранный период' }, 'Итого (Total)'),
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
    const withOpen = hasOpening(opening);
    const calm = { calm: !withOpen };
    const rows = [
      withOpen ? row('Остаток на начало дня', 'bal', cell(c.totals.opening), (d) => cell(d.opening)) : null,
      row('Поступления', 'grp in', cell(c.totals.income, { strong: true }), (d) => cell(d.income, { strong: true }), true),
      ...cos.map((co) => row(co, 'sub', cell(c.totals.incomeBy[co]), (d) => cell(d.incomeBy[co]), true)),
      row('Выплаты', 'grp out', cell(c.totals.expense, { strong: true }), (d) => cell(d.expense, { strong: true }), true),
      ...cos.map((co) => row(co, 'sub', cell(c.totals.expenseBy[co]), (d) => cell(d.expenseBy[co]), true)),
      // как ОДР у бухгалтеров: результат дня и финансовый результат нарастающим итогом (вчерашний + сегодняшний)
      row('Результат дня', 'res', cell(c.totals.income - c.totals.expense, { strong: true }), (d) => cell(d.income - d.expense)),
      row('Финансовый результат (нарастающий)', 'bal end', cell(c.totals.closing - c.totals.opening, { strong: true }), (d) => cell(d.closing - c.totals.opening)),
      withOpen ? row('Остаток денег на конец дня', 'bal', cell(c.totals.closing, { strong: true }), (d) => cell(d.closing)) : null,
    ].filter(Boolean);
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
    const kpi = (label, v, opts = {}) => h('div', { class: 'sum-item static' }, h('span', { class: 'sum-v' + (v < 0 && !opts.calm ? ' neg' : '') }, (opts.sign && v > 0 ? '+' : '') + money(v)), h('span', { class: 'sum-l' }, label));
    const upto = c.to < `${month()}-${String(lastDay(month())).padStart(2, '0')}` ? ` по ${Number(c.to.slice(8))}-е` : '';
    return [
      h('div', { class: 'summary' }, ...(withOpen
        ? [kpi('остаток на начало', t.opening), kpi('поступления' + upto, t.income), kpi('выплаты' + upto, t.expense), kpi('остаток' + (upto ? ' сегодня' : ' на конец'), t.closing)]
        : [kpi('поступления' + upto, t.income), kpi('выплаты' + upto, t.expense), kpi('итог месяца' + upto, t.income - t.expense, { calm: true, sign: true })]),
        c.needsFill.total ? h('button', { class: 'sum-item attn', type: 'button', onclick: () => go('fill') }, h('span', { class: 'sum-v' }, String(c.needsFill.total)), h('span', { class: 'sum-l' }, 'не попали в расчёт →')) : null),
      h('div', { class: 'panel cal-wrap' }, h('table', { class: 'cal' }, h('thead', null, head), h('tbody', null, rows))),
      h('p', { class: 'hint' }, `Только то, что уже было — по сегодня включительно; будущие даты здесь не показываются (для них будет отдельный прогноз). Выплаты — заявки с датой счёта, суммой и нашей компанией. Поступления — позиции заказов с суммой (по дате оплаты, иначе отгрузки). ${withOpen ? '' : 'Введите остаток денег на 1-е число — появится остаток по дням. '}Нажмите на сумму дня — увидите операции.`),
      h('div', { class: 'panel' }, opsBox),
    ];
  }

  // ---------- Сводка — обзор для директора (TASKS Д3.2, Д3.5) ----------
  function summary(s) {
    const cos = s.companies;
    const sum = (by, k) => cos.reduce((a, c) => a + (by[c]?.[k] || 0), 0);
    const year = month().slice(0, 4);
    const result = (inc, exp) => (inc ? cell(inc - exp, { strong: true }) : h('span', { class: 'muted', title: 'Доходы не внесены — у позиций заказов нет суммы' }, 'доходов нет'));
    const line = (label, by, cls) => {
      const inc = sum(by, 'income'), exp = sum(by, 'expense');
      const main = h('tr', { class: cls || '' }, h('td', null, label), h('td', { class: 'right' }, cell(inc)), h('td', { class: 'right' }, cell(exp)), h('td', { class: 'right' }, result(inc, exp)));
      if (cos.length < 2 || !(inc || exp)) return [main];
      return [main, ...cos.filter((c) => by[c]?.income || by[c]?.expense).map((c) => h('tr', { class: 'sub' }, h('td', null, c), h('td', { class: 'right' }, cell(by[c].income)), h('td', { class: 'right' }, cell(by[c].expense)), h('td', { class: 'right' }, by[c].income ? cell(by[c].income - by[c].expense) : '')))];
    };
    const name = (m) => { const [y, mo] = m.split('-').map(Number); return `${MONTHS[mo - 1]} ${y}`; };
    // месяцы года по порядок, после каждого квартала — «Итого за квартал»; будущие — не показываем (прогноз отдельно)
    const months = s.months.filter((m) => m.month <= cur());
    const first = months.findIndex((m) => sum(m.byCompany, 'income') || sum(m.byCompany, 'expense'));
    const shown = first < 0 ? [] : months.slice(first);
    const rows = []; let q = 0; let acc = null;
    const flush = () => { if (acc) rows.push(h('tr', { class: 'total q' }, h('td', null, `Итого за ${['I', 'II', 'III', 'IV'][q - 1]} квартал`), h('td', { class: 'right' }, cell(acc.i, { strong: true })), h('td', { class: 'right' }, cell(acc.e, { strong: true })), h('td', { class: 'right' }, result(acc.i, acc.e)))); };
    for (const m of shown) {
      const mq = Math.ceil(Number(m.month.slice(5)) / 3);
      if (mq !== q) { flush(); q = mq; acc = { i: 0, e: 0 }; }
      acc.i += sum(m.byCompany, 'income'); acc.e += sum(m.byCompany, 'expense');
      rows.push(...line(name(m.month), m.byCompany));
    }
    flush();
    const inc = sum(s.total, 'income'), exp = sum(s.total, 'expense');
    const kpi = (label, value, cls = '') => h('div', { class: 'sum-item static' }, h('span', { class: 'sum-v ' + cls }, value), h('span', { class: 'sum-l' }, label));
    // доли: направления / категории / поставщики — полоска = доля от самого большого
    const shares = (title, hint, list) => {
      const tot = list.reduce((a, x) => a + x.total, 0) || 1; const max = Math.max(1, ...list.map((x) => x.total));
      return h('div', { class: 'panel dash-card' }, h('div', { class: 'q-head' }, h('div', null, h('h3', null, title), h('div', { class: 'q-hint' }, hint))),
        list.length ? h('div', { class: 'shares' }, ...list.map((x) => h('div', { class: 'share' },
          // «Не указано» / «Без категории» — ссылка прямо в очередь заполнения (TASKS ТЗ.5)
          h('div', { class: 'share-l' }, UNSET[x.label] ? h('a', { class: 'clip', href: '#fill?g=' + UNSET[x.label], title: 'Открыть список и заполнить' }, x.label + ' — заполнить →') : h('span', { class: 'clip', title: x.label }, x.label), h('b', { class: 'num' }, money(x.total)), h('span', { class: 'muted num share-p' }, Math.round((x.total / tot) * 100) + '%')),
          h('div', { class: 'share-bar' }, h('i', { style: { width: Math.max(2, (x.total / max) * 100) + '%' } })))))
          : h('p', { class: 'muted', style: { padding: '0 16px 12px' } }, 'Расходов пока нет'));
    };
    return [
      h('div', { class: 'summary' },
        kpi(`поступления за ${year}`, money(inc)),
        kpi(`выплаты за ${year}`, money(exp)),
        inc ? kpi('финансовый результат', money(inc - exp), inc - exp < 0 ? 'neg' : 'pos') : kpi('финансовый результат', '—', 'muted'),
        kpi('месяцев с операциями', String(shown.length))),
      inc ? null : h('p', { class: 'hint' }, 'Доходов пока нет: у позиций заказов не вписаны суммы («Позиции и оплаты» → «Без суммы» → «Вписать сумму»). Как только появятся — посчитается финансовый результат.'),
      h('div', { class: 'dash-grid' },
        shares('Куда тратили', 'Цех / офис / СМР / заказы', (s.expensesByCostCenter || []).map((x) => ({ label: x.center, total: x.total }))),
        shares('На что тратили', 'По категориям', (s.expensesByCategory || []).map((x) => ({ label: x.category, total: x.total })).sort((a, b) => b.total - a.total)),
        shares('Кому платили', 'Топ поставщиков', (s.expensesBySupplier || []).map((x) => ({ label: x.supplier, total: x.total })))),
      h('div', { class: 'panel', style: { marginTop: '16px' } }, h('div', { class: 'q-head' }, h('h3', null, `Доходы и расходы по месяцам — ${year}`)),
        h('div', { class: 'table-wrap' }, h('table', { class: 'list sum-tbl' },
          h('thead', null, h('tr', null, h('th', null, 'Период'), h('th', { class: 'right' }, 'Поступления'), h('th', { class: 'right' }, 'Выплаты'), h('th', { class: 'right' }, 'Результат'))),
          h('tbody', null, rows.length ? rows : h('tr', null, h('td', { colspan: 4, class: 'muted' }, 'Операций пока нет')), ...line(`Итого (Total) за ${year}`, s.total, 'total'))))),
    ];
  }

  let seq = 0;
  async function load() {
    const my = ++seq;
    renderChrome();
    el.classList.add('loading');
    try {
      const m = month();
      const end = `${m}-${String(lastDay(m)).padStart(2, '0')}`;
      const q = { from: `${m}-01`, to: end < todayIso() ? end : todayIso(), org: org() };
      let content;
      // старая вкладка «Требуют заполнения» — теперь своя страница по категориям (#fill)
      if (tab() === 'fill') { go('fill', {}, { replace: true }); return; }
      if (tab() === 'summary') {
        const y = m.slice(0, 4);
        const s = await api('/finance/summary', { query: { from: `${y}-01-01`, to: `${y}-12-31` < todayIso() ? `${y}-12-31` : todayIso(), org: org() } });
        if (my !== seq) return;
        renderChrome(s.companies);
        content = summary(s);
      } else if (m > cur()) {
        content = [h('div', { class: 'panel state' }, h('div', null, 'Это будущий месяц — здесь показываются только прошедшие дни.'), h('div', { class: 'muted' }, 'План и прогноз денег будут отдельным разделом.'), h('button', { class: 'btn', type: 'button', onclick: () => patch({ month: undefined }) }, 'К текущему месяцу'))];
      } else {
        const c = await api('/finance/cashflow', { query: { ...q, opening: opening.value.trim().replace(',', '.') || 0 } });
        if (my !== seq) return;
        renderChrome(c.companies);
        content = calendar(c);
      }
      if (my !== seq) return;
      body.replaceChildren(...content.filter(Boolean));
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
