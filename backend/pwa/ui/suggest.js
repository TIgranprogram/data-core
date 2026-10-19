import { h } from '../core/dom.js';
import { searchTokens } from '../core/facets.js';

/**
 * Подсказки под полем ввода (TASKS З.7): печатаешь — внизу «уже заказывали / есть на складе»,
 * сверху — кнопки категорий для быстрого сужения; выбор заполняет сразу несколько полей формы.
 *   attachSuggest(input, { load: async () => [{ label, sub, cat, search, values }], onPick(values) })
 * search — строка для поиска (нормализованная, как в facets.js).
 */
export function attachSuggest(input, { load, onPick, title = 'Уже заказывали' }) {
  let all = null; let cat = ''; let active = 0; let shown = [];
  const box = h('div', { class: 'suggest', hidden: true, role: 'listbox' });
  input.parentElement.classList.add('has-suggest');
  input.insertAdjacentElement('afterend', box);
  const close = () => { box.hidden = true; };
  async function render() {
    if (!all) { try { all = await load(); } catch { all = []; } }
    const tokens = searchTokens(input.value);
    if (!tokens.length && !cat) { close(); return; }
    const inText = all.filter((x) => tokens.every((t) => x.search.includes(t)));
    shown = inText.filter((x) => !cat || x.cat === cat).slice(0, 12);
    const cats = [...new Set(inText.map((x) => x.cat).filter(Boolean))];
    if (!shown.length && !cats.length) { close(); return; }
    active = Math.min(active, Math.max(0, shown.length - 1));
    box.replaceChildren(...[
      h('div', { class: 'sg-head' }, h('span', null, title),
        cats.length > 1 ? h('span', { class: 'sg-cats' }, ...['', ...cats].map((c) => h('button', { type: 'button', class: 'tag' + (cat === c ? ' active' : ''), onmousedown: (e) => { e.preventDefault(); cat = c; render(); } }, c || 'Все'))) : null),
      ...shown.map((x, i) => h('div', { class: 'sg-row' + (i === active ? ' active' : ''), role: 'option', onmousedown: (e) => { e.preventDefault(); pick(x); } },
        h('div', { class: 'clip' }, x.label), h('small', null, x.sub))),
      shown.length ? null : h('div', { class: 'sg-row muted' }, 'В этой категории ничего')].filter(Boolean));
    box.hidden = false;
  }
  let picking = false;
  function pick(x) { onPick(x.values); close(); picking = true; input.dispatchEvent(new Event('input', { bubbles: true })); picking = false; }
  let tmr;
  input.addEventListener('input', () => { if (picking) return; clearTimeout(tmr); tmr = setTimeout(render, 120); });
  input.addEventListener('focus', () => { if (input.value.trim()) render(); });
  input.addEventListener('blur', () => setTimeout(close, 150));
  input.addEventListener('keydown', (e) => {
    if (box.hidden) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(shown.length - 1, active + 1); render(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(0, active - 1); render(); }
    else if (e.key === 'Enter' && shown[active]) { e.preventDefault(); pick(shown[active]); }
    else if (e.key === 'Escape') { e.stopPropagation(); close(); }
  });
}
