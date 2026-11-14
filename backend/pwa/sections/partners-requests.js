import { session } from '../core/api.js';
import { date, money, qty } from '../core/format.js';
import { badge, SUPPLY_STATUS, supplyKey } from '../ui/kit/badges.js';
import { row as kitRow, section, stack, link } from '../ui/kit/index.js';

const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
/**
 * Заявки контрагента по месяцам (замечание 2026-10-22: «заявок много — компактно»): раздел месяца — число и сумма в заголовке,
 * открыт последний месяц, остальные свёрнуты. Строка — kit row: дата и заявка, количество, статус, сумма.
 */
export function requestsByMonth(items) {
  const groups = new Map();
  for (const x of items) {
    const d = x.requestDate ? new Date(x.requestDate) : null;
    const k = d && !Number.isNaN(d.getTime()) ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` : 'none';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(x);
  }
  const keys = [...groups.keys()].sort().reverse().sort((a, b) => (a === 'none') - (b === 'none')); // «Без даты» — в конце
  const label = (k) => { if (k === 'none') return 'Без даты'; const [y, m] = k.split('-').map(Number); return `${MONTHS[m - 1]} ${y}`; };
  const row = (x) => kitRow({
    title: link({ label: `№${x.num ?? ''} ${x.title}`, href: '#requests?open=' + x.id }),
    meta: [date(x.requestDate), `${qty(x.qty)} ${x.unit || ''}`.trim()].filter(Boolean).join(' · '),
    side: [badge(SUPPLY_STATUS, supplyKey(x)), session.canMoney && x.priceHint ? money(x.priceHint) : null].filter(Boolean),
  });
  return stack(...keys.map((k, i) => {
    const list = groups.get(k);
    const sum = list.reduce((s, x) => s + (Number(x.priceHint) || 0), 0);
    return section({ title: label(k) + (session.canMoney && sum ? ' · ' + money(sum) : ''), count: list.length, open: i === 0, body: stack(...list.map(row)) });
  }));
}
