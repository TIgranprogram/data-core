import { api } from '../core/api.js';
import { h } from '../core/dom.js';
import { isoDay, qty } from '../core/format.js';
import { section, stack, link, hint } from '../ui/kit/basics.js';
import { busyBlock, failBlock } from '../ui/kit/busy.js';
const SVGNS = 'http://www.w3.org/2000/svg';

export const plural = (n, a, b, c) => { const m = n % 100, d = n % 10; return m > 10 && m < 15 ? c : d === 1 ? a : d > 1 && d < 5 ? b : c; };

export function dueText(c) {
  if (c.overdueDays > 0) return `просрочено ${c.overdueDays} ${plural(c.overdueDays, 'день', 'дня', 'дней')}`;
  if (c.daysLeft === 0 || (c.due && c.due === isoDay())) return 'сегодня';
  if (c.daysLeft > 0) return `ещё ${c.daysLeft} ${plural(c.daysLeft, 'день', 'дня', 'дней')}`;
  return '';
}

/** C176: число и переход используют тот же серверный фильтр, что таблица изделий. */
export function productIdentificationToday() {
  const body = h('div');
  const el = section({ title: 'Уточнить изделия', body, open: true });
  let request = 0;
  const load = async () => {
    const generation = ++request;
    body.replaceChildren(busyBlock('изделия'));
    try {
      const data = await api('/showcase', { query: { needsIdentification: '1', limit: 1 } });
      if (generation !== request) return;
      if (!Number.isInteger(data.total) || data.total < 0) throw new Error('Не удалось получить число изделий для уточнения.');
      body.replaceChildren(stack(link({ label: `Требует уточнения: ${qty(data.total)}`, href: '#products?needsIdentification=1' }),
        hint('Группа каталога, вид изделия или тип паспорта. Откройте таблицу и измените выбранные изделия.')));
    } catch (e) { if (generation === request) body.replaceChildren(failBlock(e, load)); }
  };
  return { el, load };
}
export function svg(tag, attrs = {}, ...kids) {
  const n = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) n.setAttribute(k, v);
  for (const k of kids.flat()) if (k) n.append(k);
  return n;
}
