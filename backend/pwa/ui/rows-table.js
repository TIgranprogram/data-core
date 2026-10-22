import { h } from '../core/dom.js';
import { downloadXlsx } from '../core/xlsx-write.js';
import { readTableFile } from '../core/xlsx-read.js';
import { toast, toastError } from './toast.js';

/**
 * Таблица строк в форме (поле `type: 'widget'`; комплектность паспорта, запрос 2026-10-22): поля в ячейках,
 * «+ Строка», «×» у строки, вставка блока из Excel (Ctrl+V в ячейку — строки и колонки разойдутся сами),
 * «⇩ Шаблон Excel» и «⇧ Загрузить Excel» (заполненный шаблон заменяет строки).
 *   rowsTable({ columns: [{ key, label, width?, num?, placeholder? }], rows, file: 'Имя шаблона', example: [...] })
 *   → { el, value — JSON-строка непустых строк (set value — строка JSON или массив), focus }
 */
export function rowsTable({ columns, rows, file = 'Шаблон', example = [] }) {
  const body = h('tbody');
  const parse = (v) => { if (Array.isArray(v)) return v; try { return JSON.parse(v || '[]') || []; } catch { return []; } };
  const cellsOf = (tr) => [...tr.querySelectorAll('input')];

  function addRow(r = {}, before = null) {
    const tr = h('tr', null,
      h('td', { class: 'rt-n' }),
      ...columns.map((c) => h('td', null, h('input', { value: r[c.key] ?? '', placeholder: c.placeholder || '', inputmode: c.num ? 'decimal' : undefined, 'aria-label': c.label, 'data-k': c.key, class: c.num ? 'num' : '' }))),
      h('td', null, h('button', { type: 'button', class: 'btn btn-ghost btn-sm btn-icon', title: 'Убрать строку', 'aria-label': 'Убрать строку', onclick: () => { tr.remove(); if (!body.children.length) addRow(); renum(); changed(); } }, '×')));
    body.insertBefore(tr, before);
    renum();
    return tr;
  }
  // номер строки — в подписях полей и кнопки «×» (читалка различает строки)
  const renum = () => [...body.children].forEach((tr, i) => {
    tr.firstChild.textContent = String(i + 1);
    cellsOf(tr).forEach((inp, k) => inp.setAttribute('aria-label', `${columns[k].label}, строка ${i + 1}`));
    const x = tr.querySelector('button'); if (x) { x.setAttribute('aria-label', `Убрать строку ${i + 1}`); x.title = `Убрать строку ${i + 1}`; }
  });
  const changed = () => el.dispatchEvent(new Event('input', { bubbles: true }));
  const read = () => [...body.children].map((tr) => Object.fromEntries(cellsOf(tr).map((i) => [i.dataset.k, i.value.trim()])))
    .filter((r) => Object.values(r).some(Boolean));
  const set = (list) => { body.replaceChildren(); (list.length ? list : [{}]).forEach((r) => addRow(r)); };

  // таблица из Excel / текста → строки (первая строка — заголовок, если похожа на подписи колонок)
  const fromText = (text) => {
    const lines = String(text).split(/\r?\n/).filter((l) => l.trim()).map((l) => l.split('\t'));
    const isHead = (cells) => cells.some((x) => columns.some((c) => x.trim().toLowerCase() === c.label.toLowerCase()));
    return (lines.length && isHead(lines[0]) ? lines.slice(1) : lines).map((cells) => Object.fromEntries(columns.map((c, i) => [c.key, (cells[i] ?? '').trim()])));
  };

  body.addEventListener('paste', (e) => {
    const text = e.clipboardData?.getData('text') || '';
    if (!/[\t\n]/.test(text.trim())) return; // одно значение — обычная вставка
    e.preventDefault();
    const inp = e.target.closest('input'); const tr = inp?.closest('tr');
    const start = cellsOf(tr).indexOf(inp);
    let row = tr;
    for (const cells of String(text).replace(/\r?\n$/, '').split(/\r?\n/).map((l) => l.split('\t'))) {
      row ??= addRow();
      cells.forEach((v, i) => { const x = cellsOf(row)[start + i]; if (x) x.value = v.trim(); });
      row = row.nextElementSibling;
    }
    changed();
  });

  const fileIn = h('input', { type: 'file', accept: '.xlsx,.csv,.txt', hidden: true, onchange: async () => {
    const f = fileIn.files?.[0]; fileIn.value = '';
    if (!f) return;
    try {
      const list = fromText(await readTableFile(f)).filter((r) => Object.values(r).some(Boolean));
      if (!list.length) { toast('В файле нет строк — заполните шаблон под заголовком'); return; }
      set(list); changed(); toast(`Загружено строк: ${list.length}`);
    } catch (e) { toastError(e); }
  } });

  const el = h('div', { class: 'rt' },
    h('div', { class: 'rt-wrap' }, h('table', { class: 'rt-table' },
      h('thead', null, h('tr', null, h('th', { class: 'rt-n' }, '№'), ...columns.map((c) => h('th', { style: c.width ? `width:${c.width}` : undefined }, c.label)), h('th'))),
      body)),
    h('div', { class: 'rt-acts' },
      h('button', { type: 'button', class: 'btn btn-sm', onclick: () => { cellsOf(addRow())[0]?.focus(); changed(); } }, '+ Строка'),
      h('span', { class: 'spacer' }),
      h('button', { type: 'button', class: 'btn btn-ghost btn-sm', title: 'Пустая таблица с нужными колонками — заполнить в Excel и загрузить', onclick: () => downloadXlsx(`${file}.xlsx`, [columns.map((c) => c.label), ...(example.length ? [example] : [])], file) }, '⇩ Шаблон Excel'),
      h('button', { type: 'button', class: 'btn btn-ghost btn-sm', title: 'Заполненный шаблон (.xlsx или .csv) — строки заменятся', onclick: () => fileIn.click() }, '⇧ Загрузить Excel'),
      fileIn));
  set(parse(rows));
  return {
    el,
    get value() { return JSON.stringify(read()); },
    set value(v) { set(parse(v)); },
    focus: () => body.querySelector('input')?.focus(),
  };
}
