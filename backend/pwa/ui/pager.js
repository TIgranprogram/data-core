import { h } from '../core/dom.js';

export const PAGE_SIZES = [25, 50, 100];

/** «‹ 1 2 3 … 9 ›» + выбор 25/50/100 строк. onPage(page), onLimit(limit). */
export function pager({ page, limit, total, onPage, onLimit }) {
  const pages = Math.max(1, Math.ceil(total / limit));
  const box = h('div', { class: 'pager' });
  const btn = (label, p, opts = {}) => h('button', {
    type: 'button', class: p === page && !opts.nav ? 'active' : '', disabled: opts.disabled,
    'aria-label': opts.aria, onclick: () => onPage(p),
  }, label);
  box.append(btn('‹', page - 1, { nav: true, disabled: page <= 1, aria: 'Предыдущая страница' }));
  const set = new Set([1, pages, page - 1, page, page + 1].filter((p) => p >= 1 && p <= pages));
  let prev = 0;
  for (const p of [...set].sort((a, b) => a - b)) {
    if (p - prev > 1) box.append(h('span', { class: 'muted' }, '…'));
    box.append(btn(String(p), p));
    prev = p;
  }
  box.append(btn('›', page + 1, { nav: true, disabled: page >= pages, aria: 'Следующая страница' }));
  box.append(h('select', { 'aria-label': 'Строк на странице', value: String(limit), onchange: (e) => onLimit(Number(e.target.value)) },
    PAGE_SIZES.map((n) => h('option', { value: String(n) }, `${n} строк`))));
  return box;
}
