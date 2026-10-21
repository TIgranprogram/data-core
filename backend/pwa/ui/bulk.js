import { h } from '../core/dom.js';
import { matchLines } from '../core/bulk-match.js';
import { parsePasted } from '../core/paste-parse.js';

/**
 * «Вставить список» — общий компонент массового ввода (TASKS МВ.3). Вставка строк из Excel / сайта / спецификации →
 * разбор (core/paste-parse.js) → сопоставление с базой (core/bulk-match.js) → найденное отдаётся разделу,
 * ненайденное показывается здесь же: «похоже на … N% — взять» или «пропустить».
 *   const b = bulkPaste({ items: () => [{ label, cat, values: { article, unit }, ref }], onFound(list: [{ item, line }]), supplierName?: () => '' })
 *   b.el — кнопка + выдвижная панель (над списком, не сдвигает таблицу ниже).
 * Подключено: «Операции» склада (бронь по списку, списание, приход, пересчёт). Заявки → «+ Из таблицы» — та же пара модулей.
 */
export function bulkPaste({ items, onFound, supplierName = () => '', title = 'Вставить список' }) {
  const area = h('textarea', { rows: 6, class: 'paste-area', placeholder: 'Скопируйте строки из Excel, спецификации или корзины сайта (артикул / наименование / количество — порядок колонок и лишние колонки не важны) и вставьте Ctrl+V' });
  const info = h('div', { class: 'hint' });
  const rest = h('div', { class: 'bulk-rest' });
  const go = h('button', { type: 'button', class: 'btn btn-primary btn-sm' }, 'Разобрать и найти');
  const panel = h('div', { class: 'panel bulk-panel', hidden: true },
    h('div', { class: 'section-title' }, title), area,
    h('div', { class: 'bulk-foot' }, go, h('button', { type: 'button', class: 'btn btn-sm', onclick: () => { panel.hidden = true; } }, 'Закрыть')), info, rest);
  const btn = h('button', { type: 'button', class: 'btn', title: 'Много позиций сразу: вставить строки из таблицы' }, '⇩ ' + title);
  btn.addEventListener('click', () => { panel.hidden = !panel.hidden; if (!panel.hidden) area.focus(); });
  go.addEventListener('click', async () => {
    const parsed = parsePasted(area.value);
    if (!parsed.length) { info.textContent = 'Не нашёл строк с позициями. Скопируйте строки целиком (наименование и количество).'; return; }
    go.disabled = true; info.textContent = 'Ищу на складе…';
    try {
      const res = await matchLines(parsed, items(), { supplierName: supplierName() });
      const found = res.filter((m) => m.item);
      if (found.length) onFound(found.map((m) => ({ item: m.item, line: m.line })));
      const miss = res.filter((m) => !m.item);
      info.textContent = `Строк: ${res.length}. Найдено и добавлено: ${found.length}${miss.length ? `, не нашлось: ${miss.length} — ниже` : ''}.`;
      rest.replaceChildren(...miss.map((m) => {
        const rowEl = h('div', { class: 'bulk-miss' },
          h('div', null, h('b', null, m.line.name), m.line.article ? h('span', { class: 'muted' }, ' · арт. ' + m.line.article) : null, h('span', { class: 'muted' }, ` · ${m.line.qty} шт`)),
          h('div', { class: 'inv-similar' },
            m.similar.length ? h('span', { class: 'muted' }, 'Похоже на: ') : h('span', { class: 'muted' }, 'На складе такой позиции нет. '),
            ...m.similar.map((s) => h('button', { type: 'button', class: 'tag', title: 'Это та же позиция — взять', onclick: () => { onFound([{ item: s.item, line: m.line }]); rowEl.remove(); } }, s.item.label.slice(0, 60), h('small', null, Math.round(s.score * 100) + '%'))),
            h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => rowEl.remove() }, 'пропустить')));
        return rowEl;
      }));
      area.value = '';
    } finally { go.disabled = false; }
  });
  return { el: h('div', { class: 'bulk' }, btn, panel), open: () => { panel.hidden = false; area.focus(); } };
}
