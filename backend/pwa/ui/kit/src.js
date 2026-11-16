import { mark } from './mark.js';
import { h } from '../../core/dom.js';

/**
 * kit.src — кусок текста по источнику: полоса слева и лёгкий фон (C130, «Текст паспорта»).
 * Источник — ключ: all (общий, серый) | type (голубой) | product (зелёный) | manual (золотой). Подписи задаёт экран.
 *   srcBox(src, labels, ...kids)   → блок с цветом; src пуст — обычный блок без цвета;
 *   srcPaint(el, src, labels)      → покрасить готовый элемент (абзац с кнопками);
 *   srcLegend(labels)              → строка подписей цветов над текстом.
 */
export function srcPaint(el, src, labels = {}) {
  if (!src) return el;
  el.classList.add('k-src');
  el.dataset.src = src;
  if (labels[src]) el.title = labels[src];
  return mark(el, 'src');
}

export const srcBox = (src, labels, ...kids) => srcPaint(h('div', null, ...kids), src, labels);

export function srcLegend(labels) {
  return mark(h('div', { class: 'k-src-legend', role: 'note', 'aria-label': 'Цвета текста' },
    ...Object.entries(labels).map(([k, label]) => h('span', { class: 'k-src-key', dataset: { src: k } }, label))), 'src');
}
