import { h } from '../../core/dom.js';
import { mark } from './mark.js';

/**
 * tabs({ items: [{ key, label, count?, sub?, marks?, today?, tone?, title? }], value, onChange(key), label (aria), layout?: 'days', fill? }) → { el, set(key) } — .chips/.chip
 *  tone — состояние вкладки цветом (ok — сделано, warn — идёт сейчас, info); fill — вкладки делят всю ширину поровну.
 *  layout 'days' — неделя: 7 равных клеток (label — число/день, sub — подпись, marks — до 3 точек по тонам info/warn/danger/ok, today — рамка).
 *  Вынесена из ui/kit/index.js в отдельный модуль, чтобы ui/kit/card.js не импортировал index.js по кругу (C052 T9).
 */
export function tabs({ items, value, onChange, label, layout: lay, fill }) {
  const days = lay === 'days';
  const el = mark(h('div', { class: days ? 'k-days' : 'chips' + (fill ? ' k-tabs-fill' : ''), role: 'tablist', 'aria-label': label || null }), 'tabs');
  const set = (key) => el.querySelectorAll(days ? '.k-day' : '.chip').forEach((c) => { const on = c.dataset.key === String(key); c.classList.toggle('active', on); c.setAttribute('aria-selected', String(on)); });
  if (days) el.append(...items.map((it) => h('button', { type: 'button', role: 'tab', class: 'k-day' + (it.today ? ' today' : ''), dataset: { key: String(it.key) }, onclick: () => { set(it.key); onChange?.(it.key); } },
    h('b', null, it.label), it.sub ? h('span', { class: 'k-day-sub' }, it.sub) : null,
    h('span', { class: 'k-day-marks', 'aria-hidden': 'true' }, ...(it.marks || []).slice(0, 3).map((m) => h('i', { class: 'tone-' + m }))))));
  else el.append(...items.map((it) => h('button', { type: 'button', role: 'tab', class: 'chip', dataset: { key: String(it.key) }, 'data-tone': it.tone || null, title: it.title || null, 'aria-label': it.title ? `${it.label}: ${it.title}` : null, onclick: () => { set(it.key); onChange?.(it.key); } },
    it.tone === 'ok' ? '✓ ' : '', it.label, it.count != null ? h('b', null, String(it.count)) : null)));
  // value: null — явно «ничего не выбрано» (шаг воронки ещё не пройден): ничего не подсвечиваем; не передан — первый, как раньше
  set(value === undefined ? items[0]?.key : value);
  return { el, set };
}
