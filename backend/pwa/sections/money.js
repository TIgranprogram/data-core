import { financialFilters } from './money-financial-filters.js';
import { FINANCE_FILTER_KEYS } from './money-operations-state.js';
import { api, PREFIX, session } from '../core/api.js';
import { h } from '../core/dom.js';
import { failBlock } from '../ui/kit/busy.js';
import { money } from '../core/format.js';
import { current, go, patch } from '../core/router.js';
import { filter, table, tabs as kitTabs, button, iconButton, segmented } from '../ui/kit/index.js';
import { mountList } from '../ui/kit/list.js';
import { openSide, noteField, sideForm } from '../ui/kit/side-form.js';
import { toast } from '../ui/kit/toast.js';
import { forecastView } from './money-forecast.js';
import { dailyPaymentsView } from './money-daily.js';
import { businessToday } from './invoice-workspace-state.js';
/**
 * «Деньги»: календарь (факт по сегодня), сводка, прогноз, долги, «требуют заполнения».
 * Считает сервер (/api/finance): выплаты — оплаченные заявки, поступления — платежи по заказам.
 * Адрес: #money?tab=articles|calendar|summary|forecast|debts&month=2026-10&org=all|СИЮ|ССЮ (articles: &mode=object&order=<id заказа>).
 * Статья, сумма периода или дата открывают операции в том же списке.
 * Остаток дней — от старта учёта. Ноль на старте — не выписка банка.
 * Пока старт не задан, вместо остатка показываем итог — без красного.
 */
const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
/** Пустые значения в долях «Куда / На что / Кому» → группа «Требуют заполнения» (sections/fill.js). */
const UNSET = { 'Не указано': 'exp-cost', 'Без категории': 'exp-category', 'Без статьи': 'exp-article', 'Поставщик не указан': 'exp-supplier' };
const cur = () => businessToday().slice(0, 7);
const lastDay = (m) => { const [y, mo] = m.split('-').map(Number); return new Date(Date.UTC(y, mo, 0)).getUTCDate(); };
const shiftMonth = (m, n) => { const [y, mo] = m.split('-').map(Number); const d = new Date(Date.UTC(y, mo - 1 + n, 1)); return d.toISOString().slice(0, 7); };
const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* */ } } };
/** Сумма ячейки: ноль — серый «0», минус — красным (если не calm). */
const cell = (v, opts = {}) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return '';
  const cls = 'num' + (n < 0 && !opts.calm ? ' neg' : '') + (opts.strong ? ' strong' : '') + (n === 0 ? ' muted' : '');
  return h('span', { class: cls }, n === 0 ? '0' : money(n).replace(' ₽', ''));
};
const todayIso = businessToday;
/** «Старт учёта» — правая панель (П3, было окно): дата и остаток на счетах каждой нашей компании. PUT /finance/settings (только админ). */
let live = null; // { month(), reload() } — открытый экран «Деньги»
const ruDate = (v) => v.split('-').reverse().join('.');
const numOf = (v) => Number(String(v ?? '').trim().replace(/\s/g, '').replace(',', '.')) || 0;
export const finStart = sideForm({
  id: 'finstart', title: 'Старт учёта', canEdit: () => session.role === 'admin', entityType: 'FinanceSettings', noun: 'настройку',
  get: async () => ({ ...(await api('/finance/settings')) }),
  heading: (st) => (st.startDate ? 'Сейчас учёт ведётся с ' + ruDate(st.startDate) : 'Старт учёта не задан'),
  editTitle: (st) => (st.startDate ? 'Изменить старт учёта' : 'Старт учёта'),
  saveLabel: 'Сохранить',
  fields: (st) => {
    const today = new Date().toISOString().slice(0, 10);
    const now = new Date(); const pad = (x) => String(x).padStart(2, '0');
    const quick = [[`${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`, 'С 1-го числа этого месяца'], [`${now.getFullYear()}-01-01`, 'С 1 января'], ...(live?.month ? [[live.month() + '-01', 'С 1-го числа открытого месяца']] : [])]
      .filter(([v], i, a) => a.findIndex(([w]) => w === v) === i);
    const total = h('b', { class: 'num' });
    const names = st.companies || [];
    return [
      noteField(h('p', { class: 'hint' }, 'Укажите день, на который известен остаток на счетах. С этой даты сайт сам считает остаток каждого дня. Операции раньше — серым, в остаток не входят. Остатки можно вписать или поправить в любой момент — календарь и прогноз пересчитаются сразу.')),
      { key: 'startDate', label: 'Дата старта', type: 'date', max: today, hint: st.startDate ? 'Очистите дату и сохраните — старт учёта будет убран' : undefined,
        mount: (fapi) => { fapi.field('startDate')?.append(filter({ mode: 'chips', items: quick.map(([v, l]) => ({ key: v, label: l + ' · ' + ruDate(v) })), value: '', label: 'Быстрый выбор даты', onChange: (v) => fapi.set('startDate', v) }).el); } },
      ...names.map((n) => ({ key: 'ob:' + n, label: 'Остаток на начало дня — ' + n + ', ₽', type: 'money', min: 0,
        mount: (fapi) => { const recount = () => { total.textContent = money(names.reduce((s, x) => s + numOf(fapi.get('ob:' + x)), 0)) + ' ₽'; }; fapi.on('ob:' + n, recount); recount(); if (n === names[names.length - 1]) fapi.field('ob:' + n)?.append(h('p', null, 'Итого на старт: ', total)); } })),
    ];
  },
  toInitial: (st) => ({ startDate: st.startDate || '', ...Object.fromEntries((st.companies || []).map((n) => ['ob:' + n, st.openingBalance?.[n] || null])) }),
  toBody: (v, st) => {
    if (!v.startDate && !st.startDate) throw new Error('Выберите дату старта');
    if (v.startDate && v.startDate > new Date().toISOString().slice(0, 10)) throw new Error('Дата старта не может быть в будущем');
    return { startDate: v.startDate || null, openingBalance: Object.fromEntries((st.companies || []).map((n) => [n, numOf(v['ob:' + n])])) };
  },
  save: async (body) => {
    const saved = await api('/finance/settings', { method: 'PUT', body });
    settings = saved; toast(saved.startDate ? 'Учёт ведётся с ' + ruDate(saved.startDate) : 'Старт учёта убран'); live?.reload();
    return {};
  },
});
/** «Старт учёта» с сервера (GET /finance/settings): есть дата — остаток считает сервер, ручной ввод не нужен. */
let settings = null;
const hasStart = () => !!settings?.startDate;
const hasOpening = (el) => hasStart() || el.value.trim() !== '' && Number(el.value.trim().replace(',', '.')) !== 0;
/** Остаток на старте учёта по выбранной компании (или по всем) равен нулю. */
const openingIsZero = (orgName) => {
  const ob = settings?.openingBalance || {};
  const names = !orgName || orgName === 'all' ? Object.keys(ob) : [orgName];
  return !names.some((n) => Number(ob[n]) > 0);
};

export function mountMoney(params) {
  let P = { ...params };
  const tab = () => P.tab || 'articles';
  const month = () => (/^\d{4}-(0[1-9]|1[0-2])$/.test(P.month || '') ? P.month : cur());
  const org = () => P.org || 'all';

  // ---------- Шапка: вкладки, месяц, компания, начальный остаток ----------
  const tabs = h('div');
  const monthLabel = h('span', { class: 'm-label' });
  const orgSeg = h('div'); // обёртка без старого .seg: вторая рамка вокруг эталона (дизайнер 15.11)
  const opening = h('input', { class: 'm-open', inputmode: 'decimal', placeholder: 'не знаю', 'aria-label': 'Остаток на начало месяца', title: 'Остаток денег на начало месяца (запоминается в этом браузере)' });
  // прогноз — «остаток на сегодня», календарь — «на 1-е число месяца» (БЗ-1)
  const openKey = () => (tab() === 'forecast' ? 'dc-forecast-opening-' + org() : 'dc-opening-' + month() + '-' + org());
  opening.addEventListener('change', () => { store.set(openKey(), opening.value.trim()); load(); });
  const nextBtn = iconButton({ icon: '›', label: 'Следующий месяц', title: 'Следующий месяц', onClick: () => patch({ month: shiftMonth(month(), step()) }) });
  // в «Сводке» листаем годами, в календаре — месяцами
  const yearly = () => tab() === 'summary' || tab() === 'articles';
  const step = () => (yearly() ? 12 : 1);
  const gear = button({ label: '⚙ Старт учёта', kind: 'ghost', size: 'S', title: 'Дата старта учёта и остатки СИЮ/ССЮ. Можно менять в любой момент.', onClick: () => startDialog() });
  gear.hidden = true;
  const controls = h('div', { class: 'm-controls' },
    h('div', { class: 'm-month' },
      iconButton({ icon: '‹', label: 'Месяц назад', title: 'Назад', onClick: () => patch({ month: shiftMonth(month(), -step()) }) }),
      monthLabel,
      nextBtn),
    orgSeg,
    h('label', { class: 'date-f' }, h('span', { class: 'm-open-l' }, 'остаток денег на 1-е'), opening),
    gear);
  const startDialog = () => openSide('finstart', 'x');
  live = { month, reload: () => load() };
  const body = h('div', { class: 'm-body' });
  let articleFilters = null;
  const el = h('div', { class: 'money' },
    h('div', { class: 'page-head' }, h('h1', null, 'Доходы и расходы'), h('span', { class: 'spacer' }), tabs,
      // главное действие экрана — кнопка, а не шестая вкладка (C118 3.2, шаблон «Сводка»)
      button({ label: 'Заполнить', kind: 'primary', title: 'Записи без статьи, компании или суммы — не попали в расчёт', onClick: () => go('fill') })),
    controls, body);

  function renderChrome(companies) {
    tabs.replaceChildren(kitTabs({ label: 'Разделы денег', items: [['articles', 'Отчёт'], ['calendar', 'Платежи по дням'], ['summary', 'По месяцам'], ['forecast', 'Прогноз'], ['debts', 'Долги']].map(([key, label]) => ({ key, label })), value: tab(),
      onChange: (k) => patch({ tab: k === 'articles' ? undefined : k }) }).el);
    const [y, m] = month().split('-').map(Number);
    monthLabel.textContent = yearly() ? `${y} год` : `${MONTHS[m - 1][0].toUpperCase()}${MONTHS[m - 1].slice(1)} ${y}`;
    orgSeg.replaceChildren(segmented({ fit: true, label: 'Компания',
      items: ['all', ...(companies || ['СИЮ', 'ССЮ'])].map((c) => ({ key: c, label: c === 'all' ? 'Все' : c })),
      value: org() || 'all', onChange: (c) => patch({ org: c === 'all' ? undefined : c }) }).el);
    opening.value = store.get(openKey()) || '';
    controls.querySelector('.m-month').hidden = ['forecast', 'articles'].includes(tab()); orgSeg.hidden = tab() === 'articles'; // прогноз — с сегодня, месяц не листается
    controls.querySelector('.m-open-l').textContent = tab() === 'forecast' ? 'остаток денег на сегодня' : 'остаток денег на 1-е';
    controls.hidden = tab() === 'fill' || tab() === 'debts';
    nextBtn.disabled = yearly() ? y >= Number(cur().slice(0, 4)) : month() >= cur(); // будущее — отдельный прогноз
    nextBtn.title = yearly() ? 'Следующий год' : 'Следующий месяц';
    opening.parentElement.hidden = (tab() !== 'calendar' && tab() !== 'forecast') || hasStart();
    // Старт и остатки — на Сводке, календаре и прогнозе (не только календарь): вписать можно в любой момент
    const moneyTab = tab() === 'calendar' || tab() === 'summary' || tab() === 'forecast';
    gear.hidden = session.role !== 'admin' || !moneyTab;
    const bal0 = hasStart() && (settings.companies || []).every((n) => !(Number(settings.openingBalance?.[n]) > 0));
    gear.textContent = !hasStart() ? '⚙ Старт учёта и остатки'
      : (bal0 ? 'Вписать остатки на ' + settings.startDate.split('-').reverse().join('.')
        : 'Учёт с ' + settings.startDate.split('-').reverse().join('.') + ' · Изменить остатки');
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
    const result = (inc, exp) => (inc ? cell(inc - exp, { strong: true }) : h('span', { class: 'muted', title: 'В заказах не вписаны цены и платежи' }, 'нет поступлений'));
    const line = (label, by, cls, prev) => {
      const inc = sum(by, 'income'), exp = sum(by, 'expense');
      const main = h('tr', { class: cls || '' }, h('td', null, label), h('td', { class: 'right' }, cell(inc)), h('td', { class: 'right' }, cell(exp)), h('td', { class: 'right' }, result(inc, exp)), ...prevCell(prev && (prev.i - prev.e)));
      if (cos.length < 2 || !(inc || exp)) return [main];
      return [main, ...cos.filter((c) => by[c]?.income || by[c]?.expense).map((c) => h('tr', { class: 'sub' }, h('td', null, c), h('td', { class: 'right' }, cell(by[c].income)), h('td', { class: 'right' }, cell(by[c].expense)), h('td', { class: 'right' }, cell((by[c].income || 0) - (by[c].expense || 0), { calm: true })), ...prevCell(0)))];
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
    const res = inc - exp;
    const resCls = res < 0 ? 'neg' : res > 0 ? 'pos' : '';
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
      inc ? null : h('p', { class: 'hint' }, 'Нет подтверждённых поступлений за период.'),
      h('div', { class: 'summary' },
        kpi(`поступления за ${year}`, money(inc), '', vs(inc, pInc)),
        kpi(`выплаты за ${year}`, money(exp), '', vs(exp, pExp)),
        inc ? kpi('итог', money(res), resCls, pInc ? vs(res, pInc - pExp) : null) : kpi('итог', '—', 'muted'),
        kpi('месяцев с операциями', String(shown.filter((m) => sum(m.byCompany, 'income') || sum(m.byCompany, 'expense')).length))),
      hasPrev ? null : h('p', { class: 'hint' }, `Сравнение с ${py} годом появится, когда в базе будут операции ${py} года за тот же период (сейчас их нет).`),
      h('div', { class: 'dash-grid' },
        shares('Куда тратили', 'Цех / офис / СМР / заказы', (s.expensesByCostCenter || []).map((x) => ({ label: x.center, total: x.total }))),
        (s.expensesByArticle ? shares('На что тратили', 'По статьям расходов', s.expensesByArticle.map((x) => ({ label: x.article, total: x.total })).sort((a, b) => b.total - a.total))
          : shares('На что тратили', 'По категориям', (s.expensesByCategory || []).map((x) => ({ label: x.category, total: x.total })).sort((a, b) => b.total - a.total))),
        shares('Кому платили', 'Топ поставщиков', (s.expensesBySupplier || []).map((x) => ({ label: x.supplier, total: x.total })))),
      h('div', { class: 'panel', style: { marginTop: '16px' } }, h('div', { class: 'q-head' }, h('h3', null, `Поступления и выплаты по месяцам — ${year}`)),
        table({ cls: 'sum-tbl', columns: [{ label: 'Период' }, { label: 'Поступления', num: true }, { label: 'Выплаты', num: true }, { label: 'Итог', num: true }, ...(hasPrev ? [{ label: `Итог ${py}`, num: true }] : [])],
          rows: [...rows, ...line(`Итого за ${year}`, s.total, 'total', { i: pInc, e: pExp })], empty: { title: 'Операций пока нет' } })),
    ];
  }

  // ---------- Долги: тот же список позиций, что был в «Позиции и оплаты» (ui/list.js), карточка справа — of=orders ----------
  let debts = null;
  const dropDebts = () => { debts?.destroy?.(); debts = null; };
  /** Параметры внутреннего списка: без вкладки и панели справа (иначе открытие карточки перезагружало бы список). */
  const debtParams = (p) => {
    const { tab: _t, of, month: _m, org: _o, days: _d, ...rest } = p;
    return { ...rest, open: of === 'orders' ? p.open : undefined, new: undefined };
  };
  async function mountDebts(my) {
    try {
      const mod = await import('./orders.js');
      if (my !== seq) return;
      dropDebts();
      debts = mountList(mod.debts, debtParams(P), {
        onOpen: (row) => go('money', { ...current().params, of: 'orders', open: row.id, new: undefined }, { replace: !!current().params.open, kind: 'card' }),
        onCreate: () => {},
        onChanged: () => {},
      });
      body.replaceChildren(debts.el);
    } catch (e) {
      if (my === seq) body.replaceChildren(failBlock(e, load, { cls: 'panel state' }));
    } finally { if (my === seq) el.classList.remove('loading'); }
  }
  let seq = 0;
  async function load() {
    const my = ++seq;
    renderChrome();
    el.classList.add('loading');
    if (tab() !== 'articles') articleFilters?.destroy();
    if (tab() === 'debts') { await mountDebts(my); return; }
    dropDebts();
    let target = body;
    try {
      const m = month();
      const end = `${m}-${String(lastDay(m)).padStart(2, '0')}`;
      if (settings === null) settings = ['admin', 'accountant'].includes(session.role) ? await api('/finance/settings').catch(() => ({})) : {}; // «Старт учёта» читают только админ и бухгалтер; менеджеру — без него, раздел открыт (2026-11-15)
      if (my !== seq) return;
      const q = { from: `${m}-01`, to: end < todayIso() ? end : todayIso(), org: org() };
      let content;
      if (tab() === 'fill') { go('fill', {}, { replace: true }); return; }
      if (tab() === 'articles') {
        renderChrome(settings?.companies);
        articleFilters ||= financialFilters();
        target = articleFilters.content;
        if (articleFilters.el.parentElement !== body) body.replaceChildren(articleFilters.el);
        await articleFilters.update(P, () => my === seq);
        return;
      } else if (tab() === 'forecast') {
        const days = [30, 60, 90].includes(Number(P.days)) ? Number(P.days) : 30;
        const f = await api('/finance/forecast', { query: { days, org: org(), ...(hasStart() ? {} : { opening: opening.value.trim().replace(',', '.') || 0 }) } });
        if (my !== seq) return;
        renderChrome(f.companies);
        content = forecastView(f, { horizon: days, hasOpening: hasOpening(opening), startDate: settings?.startDate || null, openingZero: openingIsZero(org()) });
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
        content = [h('div', { class: 'panel state' }, h('div', null, 'Это будущий месяц — здесь показываются только прошедшие дни.'), h('div', { class: 'muted' }, 'Будущие дни — во вкладке «Прогноз».'), button({ label: 'К текущему месяцу', onClick: () => patch({ month: undefined }) }))];
      } else {
        const c = await api('/finance/cashflow', { query: { ...q, ...(hasStart() ? {} : { opening: opening.value.trim().replace(',', '.') || 0 }) } });
        if (my !== seq) return;
        renderChrome(c.companies);
        content = dailyPaymentsView(c, { withOpening: !!c.startDate || hasOpening(opening) });
      }
      if (my !== seq) return;
      body.replaceChildren(...content.filter(Boolean));
    } catch (e) {
      if (my === seq) target.replaceChildren(failBlock(e, load, { cls: 'panel state' }));
    } finally { if (my === seq) el.classList.remove('loading'); }
  }
  load();
  return {
    el,
    reload: () => (tab() === 'debts' && debts ? debts.reload?.() : load()),
    destroy() { seq++; articleFilters?.destroy(); dropDebts(); },
    /** Смена вкладки/месяца/компании — без пересоздания экрана; открытая карточка — без перезагрузки данных. */
    update(next) {
      const changed = ['tab', 'month', 'org', 'days', 'mode', 'order', 'view', 'incomeMode', 'page', 'limit', 'sort', 'dir', ...FINANCE_FILTER_KEYS].some((k) => (next[k] || '') !== (P[k] || ''));
      P = { ...next };
      if (changed) load();
      else if (tab() === 'debts' && debts) debts.update?.(debtParams(P));
    },
    canEdit: session.canEdit,
  };
}
