import { h } from '../core/dom.js';
import { date, money } from '../core/format.js';
import { patch } from '../core/router.js';

/*
 * «Деньги → Прогноз» (TASKS БЗ-1) — отдельно от факта: с сегодня вперёд (30/60/90 дней), только ожидаемое.
 * Выплаты — заявки с датой счёта позже сегодня; поступления — неоплаченные позиции заказов по сроку
 * (форма «… 30%» — предоплата в день заказа, остаток — в срок). Остаток вперёд — от «остатка на сегодня».
 * Дни с минусом — кассовый разрыв (красным). Клик по сумме дня — операции. Сервер: GET /finance/forecast.
 */
const WD = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const MON = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const cell = (v, neg = false) => (v ? h('span', { class: 'num' + (neg && v < 0 ? ' neg' : '') }, money(v).replace(' ₽', '')) : '');

export function forecastView(f, { horizon, hasOpening }) {
  const days = f.days;
  const opsBox = h('div', { class: 'm-ops', hidden: true });
  const gap = new Set(f.gapDays);
  const head = h('tr', null, h('th', { class: 'sticky' }, 'Прогноз'), h('th', { class: 'tot' }, 'Итого'),
    days.map((d) => h('th', { class: 'day' + (d.weekday === 0 || d.weekday === 6 ? ' wkend' : '') + (gap.has(d.date) ? ' gap' : '') + (d.date === f.from ? ' today' : '') },
      h('b', null, String(Number(d.date.slice(8)))), h('span', null, d.date.slice(8) === '01' || d.date === f.from ? `${WD[d.weekday]} · ${MON[Number(d.date.slice(5, 7)) - 1]}` : WD[d.weekday]))));
  const showOps = (d) => {
    opsBox.hidden = false;
    opsBox.replaceChildren(h('div', { class: 'q-head' }, h('h3', null, `Ожидается ${date(d.date)}`), h('button', { class: 'btn btn-ghost btn-sm q-link', type: 'button', onclick: () => { opsBox.hidden = true; } }, 'Скрыть')),
      h('ul', { class: 'q-list' }, d.ops.map((o) => h('li', { class: 'q-row', tabindex: '0', onclick: () => patch({ of: o.type === 'income' ? 'orders' : 'requests', open: o.id }) },
        h('div', { class: 'q-main' }, h('div', { class: 'q-title' }, o.title), h('div', { class: 'q-sub' }, [o.type === 'income' ? 'поступление' : 'выплата', o.company, o.doc, o.counterparty].filter(Boolean).join(' · '))),
        h('div', { class: 'q-side' }, h('span', { class: 'num ' + (o.type === 'income' ? 'pos' : 'neg') }, (o.type === 'income' ? '+' : '−') + money(o.amount)))))));
    opsBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };
  const row = (label, cls, total, get, click) => h('tr', { class: cls }, h('th', { class: 'sticky' }, label), h('td', { class: 'tot' }, total),
    days.map((d) => { const v = get(d); const can = click && d.ops.length && v; return h('td', { class: 'day' + (gap.has(d.date) ? ' gap' : '') + (can ? ' click' : ''), onclick: can ? () => showOps(d) : undefined }, v); }));
  const cos = f.companies;
  const rows = [
    row('Ждём поступлений', 'grp in', cell(f.totals.income), (d) => cell(d.income), true),
    ...cos.map((co) => row(co, 'sub', cell(f.totals.incomeBy[co]), (d) => cell(d.incomeBy[co]), true)),
    row('К оплате', 'grp out', cell(f.totals.expense), (d) => cell(d.expense), true),
    ...cos.map((co) => row(co, 'sub', cell(f.totals.expenseBy[co]), (d) => cell(d.expenseBy[co]), true)),
    row(hasOpening ? 'Остаток денег на конец дня' : 'Итог с сегодня (без остатка)', 'bal end', cell(f.totals.closing, true), (d) => cell(d.closing, true)),
  ];
  const kpi = (label, value, cls = '') => h('div', { class: 'sum-item static' }, h('span', { class: 'sum-v ' + cls }, value), h('span', { class: 'sum-l' }, label));
  const nd = f.noDate;
  return [
    h('div', { class: 'm-horizon seg', role: 'tablist' }, ...[30, 60, 90].map((n) => h('button', { type: 'button', class: horizon === n ? 'active' : '', onclick: () => patch({ days: n === 30 ? undefined : String(n) }) }, `${n} дней`))),
    h('div', { class: 'summary' },
      kpi(`к оплате до ${date(f.week.to)}`, money(f.week.pay)),
      kpi(`ждём денег до ${date(f.week.to)}`, money(f.week.receive)),
      f.firstGap ? kpi(`кассовый разрыв с ${date(f.firstGap)}`, `самый низкий остаток: ${date(f.minBalance.date)}, ${money(f.minBalance.amount)}`, 'neg') : kpi(hasOpening ? 'кассового разрыва нет' : 'разрыв — введите остаток на сегодня', hasOpening ? '✓' : '—', hasOpening ? 'pos' : 'muted'),
      f.minBalance && !f.firstGap && hasOpening ? kpi('самый низкий остаток', `${date(f.minBalance.date)}, ${money(f.minBalance.amount)}`) : null,
      kpi(`итог за ${horizon} дней`, money(f.totals.income - f.totals.expense), f.totals.income - f.totals.expense < 0 ? 'neg' : '')),
    h('div', { class: 'panel cal-wrap' }, h('table', { class: 'cal forecast' }, h('thead', null, head), h('tbody', null, rows))),
    h('p', { class: 'hint' }, 'Только будущее — с сегодня вперёд; что уже было, — в «Платёжном календаре». К оплате — заявки с датой счёта позже сегодня. Ждём поступлений — неоплаченные позиции заказов по сроку отгрузки (изготовления, поставки); форма оплаты «… 30%» — предоплата в день заказа, остаток — в срок; срок прошёл — на сегодня как «просрочено». ' + (hasOpening ? '' : 'Введите остаток денег на сегодня — появится остаток по дням и кассовый разрыв. ') + 'Нажмите на сумму дня — увидите, что именно.'),
    h('div', { class: 'panel' }, opsBox),
    nd.items.length ? h('details', { class: 'panel m-nodate' }, h('summary', null, h('b', null, `Без срока: ${nd.items.length}`), h('span', { class: 'muted' }, ` · к оплате ${money(nd.expense)} · ждём ${money(nd.income)} — впишите дату счёта или срок заказа, тогда встанут в прогноз`)),
      h('ul', { class: 'q-list' }, nd.items.map((o) => h('li', { class: 'q-row', tabindex: '0', onclick: () => patch({ of: o.type === 'income' ? 'orders' : 'requests', open: o.id }) },
        h('div', { class: 'q-main' }, h('div', { class: 'q-title' }, o.title), h('div', { class: 'q-sub' }, [o.type === 'income' ? 'поступление' : 'выплата', o.company, o.doc, o.counterparty].filter(Boolean).join(' · '))),
        h('div', { class: 'q-side' }, h('span', { class: 'num ' + (o.type === 'income' ? 'pos' : 'neg') }, (o.type === 'income' ? '+' : '−') + money(o.amount))))))) : null,
  ];
}
