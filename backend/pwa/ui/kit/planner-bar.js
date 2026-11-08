import { h } from '../../core/dom.js';
import { button, segmented } from './index.js';

/**
 * Панель над лентой planner: масштаб (День / Неделя / Месяц / Уместить), ← Сегодня →, «Раскрыть всё / Свернуть всё» и легенда видов работ.
 * plannerBar({ lead?, scale, onScale?, onShift?(±1), onToday, tree?, onAll?(open), legend?: [{ id, name, hue }], hl?, onHl?(id|'') }) → Element | null
 */
export function plannerBar({ lead, scale, onScale, onShift, onToday, tree, onAll, legend = [], hl = '', onHl } = {}) {
  const parts = lead ? [lead] : []; // lead — элемент экрана в начале панели (переключатель «По заказам / По людям»): одна строка инструментов
  if (onScale) parts.push(segmented({ items: [{ key: 'day', label: 'День' }, { key: 'week', label: 'Неделя' }, { key: 'month', label: 'Месяц' }, { key: 'fit', label: 'Уместить' }], value: scale, label: 'Масштаб ленты', onChange: onScale }).el);
  if (onShift) parts.push(button({ label: '←', size: 'S', title: 'Раньше', onClick: () => onShift(-1) }));
  if (onShift || onScale) parts.push(button({ label: 'Сегодня', size: 'S', onClick: onToday }));
  if (onShift) parts.push(button({ label: '→', size: 'S', title: 'Позже', onClick: () => onShift(1) }));
  if (tree && onAll) parts.push(button({ label: 'Раскрыть всё', kind: 'ghost', size: 'S', onClick: () => onAll(true) }), button({ label: 'Свернуть всё', kind: 'ghost', size: 'S', onClick: () => onAll(false) }));
  const items = legend.filter((x) => x && x.name);
  const lg = items.length ? h('div', { class: 'k-pl-legend', role: 'group', 'aria-label': 'Виды работ' },
    ...items.map((x) => h('button', { type: 'button', class: 'k-pl-lg' + (String(hl) === String(x.id) ? ' on' : ''), 'aria-pressed': String(String(hl) === String(x.id)), title: 'Подсветить: ' + x.name, onclick: () => onHl?.(String(hl) === String(x.id) ? '' : String(x.id)) },
      h('i', { class: 'hue wt-' + (x.hue || 1) }), x.name))) : null;
  if (!parts.length && !lg) return null;
  return h('div', { class: 'k-pl-bar-top' }, parts.length ? h('div', { class: 'k-pl-tools' }, ...parts) : null, lg);
}
