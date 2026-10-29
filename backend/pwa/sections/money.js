import { api, PREFIX, session } from '../core/api.js';
import { h } from '../core/dom.js';
import { failBlock } from '../ui/busy.js';
import { money } from '../core/format.js';
import { go, patch } from '../core/router.js';
import { modal } from '../ui/dialog.js';
import { toast } from '../ui/toast.js';
import { opRow } from '../ui/op-row.js';
import { forecastView } from './money-forecast.js';

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
/** «Старт учёта» с сервера (GET /finance/settings): есть дата — остаток считает сервер, ручной ввод не нужен. */
let settings = null;
const hasStart = () => !!settings?.startDate;
const hasOpening = (el) => hasStart() || el.value.trim() !== '' && Number(el.value.trim().replace(',', '.')) !== 0;

export function mountMoney(params) {
  let P = { ...params };
  const tab = () => P.tab || 'calendar';
  const month = () => (/^\d{4}-\d{2}$/.test(P.month || '') ? P.month : cur());
  const org = () => P.org || 'all';

  // ---------- Шапка: вкладки, месяц, компания, начальный остаток ----------
  const tabs = h('div', { class: 'tabs', role: 'tablist' });
  const monthLabel = h('span', { class: 'm-label' });
  const orgSeg = h('div', { class: 'seg' });
  const opening = h('input', { class: 'm-open', inputmode: 'decimal', placeholder: 'не знаю', 'aria-label': 'Остаток на начало месяца', title: 'Остаток денег на начало месяца (запоминается в этом браузере)' });
  // прогноз — «остаток на сегодня», календарь — «на 1-е число месяца» (БЗ-1)
  const openKey = () => (tab() === 'forecast' ? 'dc-forecast-opening-' + org() : 'dc-opening-' + month() + '-' + org());
  opening.addEventListener('change', () => { store.set(openKey(), opening.value.trim()); load(); });
  const nextBtn = h('button', { class: 'btn btn-ghost btn-icon', type: 'button', title: 'Следующий месяц', onclick: () => patch({ month: shiftMonth(month(), step()) }) }, '›');
  // в «Сводке» листаем годами, в календаре — месяцами
  const step = () => (tab() === 'summary' ? 12 : 1);
  const gear = h('button', { class: 'btn btn-ghost btn-sm', type: 'button', hidden: true, title: 'Дата, с которой ведётся учёт, и остаток на счетах наших компаний', onclick: () => startDialog() }, '⚙ Старт учёта');
  const controls = h('div', { class: 'm-controls' },
    h('div', { class: 'm-month' },
      h('button', { class: 'btn btn-ghost btn-icon', type: 'button', title: 'Назад', onclick: () => patch({ month: shiftMonth(month(), -step()) }) }, '‹'),
      monthLabel,
      nextBtn),
    orgSeg,
    h('label', { class: 'date-f' }, h('span', { class: 'm-open-l' }, 'остаток денег на 1-е'), opening),
    gear);
  async function startDialog() {
    const st = await api('/finance/settings');
    const ru = (v) => v.split('-').reverse().join('.');
    const num = (inp) => Number(inp.value.trim().replace(/\s/g, '').replace(',', '.')) || 0;
    const dt = h('input', { type: 'date', value: st.startDate || '', max: new Date().toISOString().slice(0, 10) });
    const ins = (st.companies || []).map((n) => [n, h('input', { inputmode: 'decimal', placeholder: '0,00', value: st.openingBalance?.[n] ? String(st.openingBalance[n]).replace('.', ',') : '' })]);
    const total = h('b', { class: 'num' });
    const recount = () => { total.textContent = money(ins.reduce((t, [, inp]) => t + num(inp), 0)) + ' ₽'; };
    ins.forEach(([, inp]) => inp.addEventListener('input', recount)); recount();
    // быстрый выбор: 1-е текущего месяца, 1 января, 1-е выбранного в календаре месяца
    const now = new Date(); const pad = (x) => String(x).padStart(2, '0');
    const quick = [[`${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`, 'С 1-го числа этого месяца'], [`${now.getFullYear()}-01-01`, 'С 1 января'], [month() + '-01', 'С 1-го числа открытого месяца']]
      .filter(([v], i, a) => a.findIndex(([w]) => w === v) === i);
    const chips = h('div', { class: 'chips' }, ...quick.map(([v, l]) => h('button', { type: 'button', class: 'chip', onclick: () => { dt.value = v; } }, l + ' · ' + ru(v))));
    const now0 = st.startDate
      ? h('p', null, 'Сейчас учёт ведётся с ', h('b', null, ru(st.startDate)), '. Выберите новую дату — остаток пересчитается.')
      : h('p', null, 'Старт учёта не задан. Остаток месяца сейчас вводится вручную.');
    let clear = false;
    const saved = await modal({
      title: st.startDate ? 'Изменить старт учёта' : 'Старт учёта',
      okText: 'Сохранить',
      body: h('div', null,
        now0,
        h('p', { class: 'hint' }, 'Укажите день, на который известен остаток на счетах. С этой даты сайт сам считает остаток каждого дня. Операции раньше — серым, в остаток не входят.'),
        chips,
        h('div', { class: 'form-grid' },
          h('label', { class: 'field' }, h('span', null, 'Дата старта'), dt),
          ...ins.map(([n, inp]) => h('label', { class: 'field' }, h('span', null, 'Остаток на начало дня — ' + n + ', ₽'), inp))),
        h('p', null, 'Итого на старт: ', total),
        st.startDate ? h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: (e) => { clear = true; dt.value = ''; e.currentTarget.textContent = 'Старт будет убран после «Сохранить»'; } }, 'Убрать старт учёта') : null),
      onOk: () => {
        if (!clear && !dt.value) throw new Error('Выберите дату старта');
        if (dt.value && dt.value > new Date().toISOString().slice(0, 10)) throw new Error('Дата старта не может быть в будущем');
        return api('/finance/settings', { method: 'PUT', body: { startDate: dt.value || null, openingBalance: Object.fromEntries(ins.map(([n, inp]) => [n, num(inp)])) } });
      },
    });
    if (saved) { settings = saved; toast(saved.startDate ? 'Учёт ведётся с ' + ru(saved.startDate) : 'Старт учёта убран'); load(); }
  }
  const body = h('div', { class: 'm-body' });
  const el = h('div', { class: 'money' },
    h('div', { class: 'page-head' }, h('h1', null, 'Деньги'), h('span', { class: 'spacer' }), tabs),
    controls, body);

  function renderChrome(companies) {
    tabs.replaceChildren(...[['calendar', 'Платёжный календарь'], ['summary', 'Сводка'], ['forecast', 'Прогноз'], ['fill', 'Требуют заполнения']].map(([k, l]) =>
      h('button', { type: 'button', class: tab() === k ? 'active' : '', onclick: () => (k === 'fill' ? go('fill') : patch({ tab: k === 'calendar' ? undefined : k })) }, l)));
    const [y, m] = month().split('-').map(Number);
    monthLabel.textContent = tab() === 'summary' ? `${y} год` : `${MONTHS[m - 1][0].toUpperCase()}${MONTHS[m - 1].slice(1)} ${y}`;
    orgSeg.replaceChildren(...['all', ...(companies || ['СИЮ', 'ССЮ'])].map((c) =>
      h('button', { type: 'button', class: org() === c ? 'active' : '', onclick: () => patch({ org: c === 'all' ? undefined : c }) }, c === 'all' ? 'Все' : c)));
    opening.value = store.get(openKey()) || '';
    controls.querySelector('.m-month').hidden = tab() === 'forecast'; // прогноз — с сегодня, месяц не листается
    controls.querySelector('.m-open-l').textContent = tab() === 'forecast' ? 'остаток денег на сегодня' : 'остаток денег на 1-е';
    controls.hidden = tab() === 'fill';
    nextBtn.disabled = tab() === 'summary' ? y >= Number(cur().slice(0, 4)) : month() >= cur(); // будущее — отдельный прогноз
    nextBtn.title = tab() === 'summary' ? 'Следующий год' : 'Следующий месяц';
    opening.parentElement.hidden = (tab() !== 'calendar' && tab() !== 'forecast') || hasStart();
    gear.hidden = session.role !== 'admin' || (tab() !== 'calendar' && tab() !== 'forecast');
    gear.textContent = hasStart() ? 'Учёт с ' + settings.startDate.split('-').reverse().join('.') + ' · Изменить' : '⚙ Старт учёта';
  }

  // ---------- Календарь ----------
  function calendar(c) {
    const days = c.days;
    const sel = { date: null };
    const opsBox = h('div', { class: 'm-ops', hidden: true });
    const head = h('tr', null, h('th', { class: 'sticky' }, 'Показатель'), h('th', { class: 'tot', title: 'Итог за выбранный период' }, 'Итого'),
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
    // «Ещё не деньги»: в остаток не входят; клик по сумме дня — список
    const pendRow = (label, p, hint) => {
      if (!p || !p.total) return null;
      const byDay = (d) => ({ date: d.date, ops: p.items.filter((o) => o.date === d.date) });
      const late = p.items.filter((o) => o.date < c.from);
      return h('tr', { class: 'pend', title: hint },
        h('th', { class: 'sticky' }, label), h('td', { class: 'tot', onclick: () => showOps({ date: c.to, ops: p.items, title: label }), style: { cursor: 'pointer' } }, cell(p.total)),
        days.map((d) => { const x = byDay(d); const v = x.ops.reduce((a, o) => a + o.amount, 0) + (d.date === c.from ? late.reduce((a, o) => a + o.amount, 0) : 0); return h('td', { class: 'day' + (v ? ' click' : ''), onclick: v ? () => showOps({ date: d.date, title: label, ops: d.date === c.from ? [...late, ...x.ops] : x.ops }) : undefined }, cell(v)); }));
    };
    const pendRows = [pendRow('Счета к оплате (не в остатке)', c.pending?.invoices, 'Заявки с датой счёта, ещё не оплаченные: деньги не ушли, в остаток не входят'),
      pendRow('Отгружено без оплаты (не в остатке)', c.pending?.awaiting, 'Позиции отгружены, оплаты ещё нет: деньги не пришли, в остаток не входят')];
    const withOpen = hasOpening(opening);
    const startDate = c.startDate || settings?.startDate || null;
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
      ...pendRows,
    ].filter(Boolean);
    function showOps(d) {
      sel.date = d.date;
      const dd = new Date(d.date + 'T00:00:00Z');
      opsBox.hidden = false;
      opsBox.replaceChildren(
        h('div', { class: 'q-head' }, h('h3', null, d.title || `Операции ${dd.getUTCDate()} ${MONTHS[dd.getUTCMonth()].replace(/ь$/, 'я').replace(/й$/, 'я').replace(/т$/, 'та')}`),
          h('button', { class: 'btn btn-ghost btn-sm q-link', type: 'button', onclick: () => { opsBox.hidden = true; } }, 'Скрыть')),
        h('ul', { class: 'q-list' }, d.ops.map(opRow)));
      opsBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    const t = c.totals;
    const mt = c.metrics;
    const tile = (label, v, cls = '', onclick) => h(onclick ? 'button' : 'div', { ...(onclick ? { type: 'button', onclick } : {}), class: 'td-tile m-tile' }, h('span', { class: 'td-tl', title: label }, label), h('span', { class: 'td-tv ' + cls }, money(v)));
    const tiles = mt ? h('div', { class: 'td-tiles m-tiles' },
      tile('поступило', mt.received, 'pos'), tile('выплачено', mt.paid), tile('сальдо', mt.saldo, mt.saldo < 0 ? 'neg' : ''),
      tile('ожидается поступлений', mt.expectedIncome), tile('счета к оплате', mt.invoicesToPay), tile('просрочено', mt.overdueInvoices, mt.overdueInvoices > 0 ? 'neg' : '')) : null;
    const allOps = days.flatMap((d) => d.ops);
    const fillLink = h('a', { href: '#fill' }, 'Требуют заполнения');
    const nf = c.needsFill?.total || 0;
    const empty = !allOps.length ? h('p', { class: 'hint' }, 'За месяц нет операций.', nf ? [` Не попало в расчёт: ${nf} — «`, fillLink, '».'] : '')
      : !allOps.some((o) => o.type === 'expense') ? h('p', { class: 'hint' }, 'Расходов нет. Появятся у заявок с суммой, датой счёта и нашей компанией — см. «', fillLink, '».') : null;
    const kpi = (label, v, opts = {}) => h('div', { class: 'sum-item static' }, h('span', { class: 'sum-v' + (v < 0 && !opts.calm ? ' neg' : '') }, (opts.sign && v > 0 ? '+' : '') + money(v)), h('span', { class: 'sum-l' }, label));
    const upto = c.to < `${month()}-${String(lastDay(month())).padStart(2, '0')}` ? ` по ${Number(c.to.slice(8))}-е` : '';
    return [
      tiles,
      empty,
      startDate ? h('p', { class: 'hint' }, 'Учёт ведётся с ' + startDate.split('-').reverse().join('.') + '; операции раньше — серым, в остаток не входят.') : null,
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
  function summary(s, p) {
    const cos = s.companies;
    const sum = (by, k) => cos.reduce((a, c) => a + (by[c]?.[k] || 0), 0);
    const year = month().slice(0, 4);
    const py = String(Number(year) - 1);
    // сравнение с тем же периодом прошлого года (TASKS Д3.5): месяц → { i, e }
    const pm = new Map((p?.months || []).map((m) => [m.month.slice(5), { i: sum(m.byCompany, 'income'), e: sum(m.byCompany, 'expense') }]));
    const pInc = p ? sum(p.total, 'income') : 0, pExp = p ? sum(p.total, 'expense') : 0;
    const hasPrev = !!(pInc || pExp);
    const prevCell = (v) => (hasPrev ? [h('td', { class: 'right muted' }, v ? cell(v) : '—')] : []);
    const result = (inc, exp) => (inc ? cell(inc - exp, { strong: true }) : h('span', { class: 'muted', title: 'Доходы не внесены — у позиций заказов нет суммы' }, 'доходов нет'));
    const line = (label, by, cls, prev) => {
      const inc = sum(by, 'income'), exp = sum(by, 'expense');
      const main = h('tr', { class: cls || '' }, h('td', null, label), h('td', { class: 'right' }, cell(inc)), h('td', { class: 'right' }, cell(exp)), h('td', { class: 'right' }, result(inc, exp)), ...prevCell(prev && (prev.i - prev.e)));
      if (cos.length < 2 || !(inc || exp)) return [main];
      return [main, ...cos.filter((c) => by[c]?.income || by[c]?.expense).map((c) => h('tr', { class: 'sub' }, h('td', null, c), h('td', { class: 'right' }, cell(by[c].income)), h('td', { class: 'right' }, cell(by[c].expense)), h('td', { class: 'right' }, by[c].income ? cell(by[c].income - by[c].expense) : ''), ...prevCell(0)))];
    };
    const name = (m) => { const [y, mo] = m.split('-').map(Number); return `${MONTHS[mo - 1]} ${y}`; };
    // месяцы года по порядок, после каждого квартала — «Итого за квартал»; будущие — не показываем (прогноз отдельно)
    const months = s.months.filter((m) => m.month <= cur());
    const first = months.findIndex((m) => sum(m.byCompany, 'income') || sum(m.byCompany, 'expense'));
    const shown = first < 0 ? [] : months.slice(first);
    const rows = []; let q = 0; let acc = null;
    const flush = () => { if (acc) rows.push(h('tr', { class: 'total q' }, h('td', null, `Итого за ${['I', 'II', 'III', 'IV'][q - 1]} квартал`), h('td', { class: 'right' }, cell(acc.i, { strong: true })), h('td', { class: 'right' }, cell(acc.e, { strong: true })), h('td', { class: 'right' }, result(acc.i, acc.e)), ...prevCell(acc.pi - acc.pe))); };
    for (const m of shown) {
      const mq = Math.ceil(Number(m.month.slice(5)) / 3);
      if (mq !== q) { flush(); q = mq; acc = { i: 0, e: 0, pi: 0, pe: 0 }; }
      const pr = pm.get(m.month.slice(5));
      acc.i += sum(m.byCompany, 'income'); acc.e += sum(m.byCompany, 'expense'); acc.pi += pr?.i || 0; acc.pe += pr?.e || 0;
      rows.push(...line(name(m.month), m.byCompany, '', pr));
    }
    flush();
    const inc = sum(s.total, 'income'), exp = sum(s.total, 'expense');
    // «в 2025: 1 200 000 ₽ · +12%» — тот же период прошлого года
    const vs = (now, was) => {
      if (!hasPrev) return null;
      const pct = was ? Math.round(((now - was) / Math.abs(was)) * 100) : null;
      return h('span', { class: 'sum-d', title: `${py} год, тот же период` }, `в ${py}: ${money(was)}`, pct === null ? '' : h('b', null, ` · ${pct > 0 ? '+' : ''}${pct}%`));
    };
    const kpi = (label, value, cls = '', cmp = null) => h('div', { class: 'sum-item static' }, h('span', { class: 'sum-v ' + cls }, value), h('span', { class: 'sum-l' }, label), cmp);
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
        kpi(`поступления за ${year}`, money(inc), '', vs(inc, pInc)),
        kpi(`выплаты за ${year}`, money(exp), '', vs(exp, pExp)),
        inc ? kpi('финансовый результат', money(inc - exp), inc - exp < 0 ? 'neg' : 'pos', pInc ? vs(inc - exp, pInc - pExp) : null) : kpi('финансовый результат', '—', 'muted'),
        kpi('месяцев с операциями', String(shown.filter((m) => sum(m.byCompany, 'income') || sum(m.byCompany, 'expense')).length))),
      inc ? null : h('p', { class: 'hint' }, 'Доходов пока нет: у позиций заказов не вписаны суммы («Позиции и оплаты» → «Без суммы» → «Вписать сумму»). Как только появятся — посчитается финансовый результат.'),
      hasPrev ? null : h('p', { class: 'hint' }, `Сравнение с ${py} годом появится, когда в базе будут операции ${py} года за тот же период (сейчас их нет).`),
      h('div', { class: 'dash-grid' },
        shares('Куда тратили', 'Цех / офис / СМР / заказы', (s.expensesByCostCenter || []).map((x) => ({ label: x.center, total: x.total }))),
        shares('На что тратили', 'По категориям', (s.expensesByCategory || []).map((x) => ({ label: x.category, total: x.total })).sort((a, b) => b.total - a.total)),
        shares('Кому платили', 'Топ поставщиков', (s.expensesBySupplier || []).map((x) => ({ label: x.supplier, total: x.total })))),
      h('div', { class: 'panel', style: { marginTop: '16px' } }, h('div', { class: 'q-head' }, h('h3', null, `Доходы и расходы по месяцам — ${year}`)),
        h('div', { class: 'table-wrap' }, h('table', { class: 'list sum-tbl' },
          h('thead', null, h('tr', null, h('th', null, 'Период'), h('th', { class: 'right' }, 'Поступления'), h('th', { class: 'right' }, 'Выплаты'), h('th', { class: 'right' }, 'Результат'), hasPrev ? h('th', { class: 'right', title: 'Результат того же месяца прошлого года' }, `Результат ${py}`) : null)),
          h('tbody', null, rows.length ? rows : h('tr', null, h('td', { colspan: hasPrev ? 5 : 4, class: 'muted' }, 'Операций пока нет')), ...line(`Итого (Total) за ${year}`, s.total, 'total', { i: pInc, e: pExp }))))),
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
      if (settings === null) settings = await api('/finance/settings').catch((e) => { if (e.status === 403) throw new Error('Нет доступа к разделу «Деньги»'); return {}; });
      const q = { from: `${m}-01`, to: end < todayIso() ? end : todayIso(), org: org() };
      let content;
      // старая вкладка «Требуют заполнения» — теперь своя страница по категориям (#fill)
      if (tab() === 'fill') { go('fill', {}, { replace: true }); return; }
      if (tab() === 'forecast') {
        const days = [30, 60, 90].includes(Number(P.days)) ? Number(P.days) : 30;
        const f = await api('/finance/forecast', { query: { days, org: org(), ...(hasStart() ? {} : { opening: opening.value.trim().replace(',', '.') || 0 }) } });
        if (my !== seq) return;
        renderChrome(f.companies);
        content = forecastView(f, { horizon: days, hasOpening: hasOpening(opening) });
      } else if (tab() === 'summary') {
        const y = m.slice(0, 4);
        const to = `${y}-12-31` < todayIso() ? `${y}-12-31` : todayIso();
        // прошлый год — тот же отрезок (1 января … та же дата), чтобы сравнение было честным
        const pTo = `${Number(y) - 1}${to.slice(4)}`.replace(/-02-29$/, '-02-28');
        const [s, p] = await Promise.all([
          api('/finance/summary', { query: { from: `${y}-01-01`, to, org: org() } }),
          api('/finance/summary', { query: { from: `${Number(y) - 1}-01-01`, to: pTo, org: org() } }).catch((e) => { if (e.status === 403) throw new Error('Нет доступа к сводке прошлого года'); return null; }),
        ]);
        if (my !== seq) return;
        renderChrome(s.companies);
        content = summary(s, p);
      } else if (m > cur()) {
        content = [h('div', { class: 'panel state' }, h('div', null, 'Это будущий месяц — здесь показываются только прошедшие дни.'), h('div', { class: 'muted' }, 'План и прогноз денег будут отдельным разделом.'), h('button', { class: 'btn', type: 'button', onclick: () => patch({ month: undefined }) }, 'К текущему месяцу'))];
      } else {
        const c = await api('/finance/cashflow', { query: { ...q, ...(hasStart() ? {} : { opening: opening.value.trim().replace(',', '.') || 0 }) } });
        if (my !== seq) return;
        renderChrome(c.companies);
        content = calendar(c);
      }
      if (my !== seq) return;
      body.replaceChildren(...content.filter(Boolean));
    } catch (e) {
      if (my === seq) body.replaceChildren(failBlock(e, load, { cls: 'panel state' }));
    } finally { if (my === seq) el.classList.remove('loading'); }
  }
  load();

  return {
    el,
    reload: load,
    /** Смена вкладки/месяца/компании — без пересоздания экрана; открытая карточка — без перезагрузки данных. */
    update(next) {
      const changed = ['tab', 'month', 'org', 'days'].some((k) => (next[k] || '') !== (P[k] || ''));
      P = { ...next };
      if (changed) load();
    },
    canEdit: session.canEdit,
  };
}
