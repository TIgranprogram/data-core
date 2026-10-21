import { api } from '../core/api.js';
import { h } from '../core/dom.js';
import { money, qty } from '../core/format.js';

/**
 * «ФОТ» — фонд оплаты труда (TASKS Д3.6). ПРЕЗЕНТАЦИОННАЯ страница: показывает, как будет выглядеть учёт
 * зарплат (сотрудник, ставка за месяц или час, график выплат, начислено / выплачено), данные — примерные.
 * Включается/выключается одной строкой: FEATURES.payroll в main.js. Своих данных и API нет — удаляется без следов.
 */
const DEMO = [
  { name: 'Иванов Сергей', role: 'Сварщик', company: 'СИЮ', kind: 'hour', rate: 450, hours: 168, schedule: 'два раза в месяц (10 и 25)', paid: 37800 },
  { name: 'Петров Алексей', role: 'Слесарь-сборщик', company: 'СИЮ', kind: 'hour', rate: 380, hours: 160, schedule: 'два раза в месяц (10 и 25)', paid: 30400 },
  { name: 'Смирнова Ольга', role: 'Бухгалтер', company: 'ССЮ', kind: 'month', rate: 65000, schedule: 'раз в месяц (5-го)', paid: 65000 },
  { name: 'Кузнецов Дмитрий', role: 'Менеджер снабжения', company: 'ССЮ', kind: 'month', rate: 70000, schedule: 'два раза в месяц (10 и 25)', paid: 35000 },
  { name: 'Попов Игорь', role: 'Маляр', company: 'Спортсет', kind: 'hour', rate: 400, hours: 120, schedule: 'раз в две недели', paid: 24000 },
];
const accrued = (p) => (p.kind === 'hour' ? p.rate * (p.hours || 0) : p.rate);

/**
 * Настоящие сотрудники (TASKS Л.4): «Справочники → Сотрудники» со ставкой. Пока ни у кого ставки нет — пример ниже.
 * Начисления и выплаты по месяцам ещё не ведутся — показываем ставку, вид оплаты и график выплат.
 */
function realView(people, refs) {
  const sched = new Map((refs.payoutSchedules || []).map((x) => [x.value, x.label]));
  const monthly = people.filter((p) => p.salaryKind !== 'hour').reduce((s, p) => s + (Number(p.salaryRate) || 0), 0);
  const kpi = (l, v) => h('div', { class: 'sum-item static' }, h('span', { class: 'sum-v' }, v), h('span', { class: 'sum-l' }, l));
  return h('div', { class: 'payroll' },
    h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'ФОТ'), h('div', { class: 'sub' }, 'Сотрудники и ставки — из «Справочники → Сотрудники». Начисления и выплаты по месяцам появятся позже.'))),
    h('div', { class: 'summary' }, kpi('сотрудников со ставкой', qty(people.length)), kpi('оклады в месяц', money(monthly)), kpi('почасовых', qty(people.filter((p) => p.salaryKind === 'hour').length))),
    h('div', { class: 'panel' }, h('div', { class: 'table-wrap' }, h('table', { class: 'list' },
      h('thead', null, h('tr', null, ...['Сотрудник', 'Должность', 'Вид работ', 'Статус', 'Ставка', 'График выплат'].map((x, i) => h('th', { class: i === 4 ? 'right' : '' }, x)))),
      h('tbody', null, ...people.map((p) => h('tr', { tabindex: '0', onclick: () => { location.hash = '#dicts?d=persons&of=dict&open=' + p.id; } },
        h('td', null, h('b', null, p.name)), h('td', null, p.position), h('td', null, p.workTypeName || ''), h('td', null, p.statusLabel),
        h('td', { class: 'num right' }, money(p.salaryRate) + (p.salaryKind === 'hour' ? ' / час' : ' / мес')),
        h('td', { class: 'muted' }, sched.get(p.payoutScheduleId) || '—'))))))),
    h('p', { class: 'hint' }, 'Клик по строке — карточка сотрудника: ставка, график, вид работ.'));
}

export function mountPayroll() {
  const box = h('div', null, h('div', { class: 'panel state' }, 'Загрузка…'));
  api('/dicts/persons').then((r) => {
    const people = r.items.filter((p) => p.status !== 'fired' && Number(p.salaryRate) > 0);
    box.replaceChildren(people.length ? realView(people, r.dict.refs || {}) : demoView());
  }).catch(() => box.replaceChildren(demoView()));
  return { el: box, reload: () => {}, update: () => {} };
}

/** Пример: пока ставки сотрудникам не внесены. */
function demoView() {
  const rows = DEMO.map((p) => ({ ...p, accrued: accrued(p) }));
  const total = rows.reduce((s, p) => s + p.accrued, 0);
  const paid = rows.reduce((s, p) => s + p.paid, 0);
  const byCo = {};
  for (const p of rows) byCo[p.company] = (byCo[p.company] || 0) + p.accrued;
  const kpi = (l, v) => h('div', { class: 'sum-item static' }, h('span', { class: 'sum-v' }, v), h('span', { class: 'sum-l' }, l));
  const el = h('div', { class: 'payroll' },
    h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'ФОТ'), h('div', { class: 'sub' }, 'Фонд оплаты труда: кто сколько получает и когда выплаты'))),
    h('p', { class: 'hint demo-note' }, 'Это пример, как будет выглядеть раздел. Данные условные. Внесите сотрудникам ставку в «Справочники → Сотрудники» — здесь появятся настоящие.'),
    h('div', { class: 'summary' }, kpi('сотрудников', qty(rows.length)), kpi('начислено за месяц', money(total)), kpi('выплачено', money(paid)), kpi('к выплате', money(total - paid))),
    h('div', { class: 'panel' }, h('div', { class: 'table-wrap' }, h('table', { class: 'list' },
      h('thead', null, h('tr', null, ...['Сотрудник', 'Должность', 'Компания', 'Ставка', 'Часы', 'Начислено', 'Выплачено', 'Остаток', 'Выплаты'].map((t, i) => h('th', { class: i >= 3 && i <= 7 ? 'right' : '' }, t)))),
      h('tbody', null, ...rows.map((p) => h('tr', null,
        h('td', null, h('b', null, p.name)), h('td', null, p.role), h('td', null, p.company),
        h('td', { class: 'num right' }, p.kind === 'hour' ? `${money(p.rate)} / час` : `${money(p.rate)} / мес`),
        h('td', { class: 'num right' }, p.kind === 'hour' ? qty(p.hours) : '—'),
        h('td', { class: 'num right' }, money(p.accrued)), h('td', { class: 'num right' }, money(p.paid)),
        h('td', { class: 'num right ' + (p.accrued - p.paid > 0 ? 'neg' : '') }, money(p.accrued - p.paid)),
        h('td', { class: 'muted' }, p.schedule)))),
      h('tfoot', null, h('tr', { class: 'total' }, h('td', { colspan: 5 }, 'Итого (Total)'), h('td', { class: 'num right' }, money(total)), h('td', { class: 'num right' }, money(paid)), h('td', { class: 'num right' }, money(total - paid)), h('td'))))))
    , h('div', { class: 'panel dash-card compact-card', style: { marginTop: '16px' } }, h('div', { class: 'q-head' }, h('h3', null, 'ФОТ по компаниям')),
      h('div', { class: 'shares' }, ...Object.entries(byCo).map(([c, v]) => h('div', { class: 'share' },
        h('div', { class: 'share-l' }, h('span', null, c), h('b', { class: 'num' }, money(v)), h('span', { class: 'muted num share-p' }, Math.round((v / total) * 100) + '%')),
        h('div', { class: 'share-bar' }, h('i', { style: { width: (v / Math.max(...Object.values(byCo))) * 100 + '%' } })))))));
  return el;
}
