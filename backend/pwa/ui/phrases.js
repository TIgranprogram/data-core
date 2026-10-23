import { h } from '../core/dom.js';
import { normSearch, searchTokens } from '../core/facets.js';
import { highlight, placeList } from './popup.js';

/**
 * Готовые тексты для длинного поля (TASKS ПС.5: «Описание» паспорта — материалы, установка, назначение).
 * Под полем — «▾ Варианты»: список уже использованных текстов, сначала — для выбранной категории (кнопки «Категория / Все»),
 * печатаешь — список сужается; выбор вставляет текст целиком. Свой текст просто вписать: после сохранения он появится в вариантах.
 *   attachPhrases(textarea, { load: async () => [{ text, n, categories }], context: () => 'Категория', title })
 */
export function attachPhrases(input, { load, context = () => '', title = 'Варианты', label = (c) => c }) {
  let all = null; let scope = 'cat'; let active = 0; let shown = [];
  const box = h('div', { class: 'suggest phrase-list', hidden: true, role: 'listbox' });
  const count = h('span', { class: 'ph-n' });
  const btn = h('button', { type: 'button', class: 'link-btn ph-btn', 'aria-haspopup': 'listbox', onmousedown: (e) => { e.preventDefault(); box.hidden ? open(true) : close(); } }, '▾ ', title, ' ', count);
  input.parentElement.classList.add('has-suggest');
  input.insertAdjacentElement('afterend', box);
  box.insertAdjacentElement('afterend', btn);
  const close = () => { box.hidden = true; btn.setAttribute('aria-expanded', 'false'); };
  const ensure = async () => { if (!all) { try { all = (await load()).map((x) => ({ ...x, search: normSearch(x.text) })); } catch { all = []; } } return all; };
  ensure().then(() => updateCount());
  function inCat(x) { const c = context(); return !c || (x.categories || []).includes(c); }
  function updateCount() {
    if (!all) return;
    const n = all.filter(inCat).length;
    count.textContent = all.length ? `(${context() && n ? n + ' для «' + label(context()) + '»' : all.length})` : ''; // label — название вместо кода (ПК)
    btn.hidden = !all.length;
  }
  async function open(fromButton = false) {
    await ensure();
    const cat = context();
    const typed = input.value.trim();
    // текст уже вставлен из вариантов (совпадает) — показываем всё, иначе сужаем по введённому
    const exact = all.some((x) => x.text === typed);
    const tokens = !fromButton && !exact ? searchTokens(typed) : [];
    const byText = all.filter((x) => tokens.every((t) => x.search.includes(t)));
    const catRows = byText.filter(inCat);
    const useCat = scope === 'cat' && cat && catRows.length;
    shown = (useCat ? catRows : byText).slice(0, 40);
    if (!shown.length) { close(); return; }
    active = Math.min(active, shown.length - 1);
    box.replaceChildren(
      h('div', { class: 'sg-head' }, h('span', null, cat ? `${title}: сначала для «${cat}»` : title + ' из выданных паспортов'),
        cat ? h('span', { class: 'sg-cats' }, ...[['cat', cat + ` · ${catRows.length}`], ['all', `Все · ${byText.length}`]].map(([k, l]) =>
          h('button', { type: 'button', class: 'tag' + ((useCat ? 'cat' : 'all') === k ? ' active' : ''), onmousedown: (e) => { e.preventDefault(); scope = k; open(fromButton); } }, l))) : null),
      ...shown.map((x, i) => h('div', { class: 'sg-row' + (i === active ? ' active' : ''), role: 'option', onmousedown: (e) => { e.preventDefault(); pick(x); } },
        h('div', { class: 'opt-l ph-text' }, highlight(x.text, tokens.length ? typed : '')),
        h('small', null, `в ${x.n} паспорт${x.n % 10 === 1 && x.n % 100 !== 11 ? 'е' : 'ах'}${x.categories?.length ? ' · ' + x.categories.map(label).join(', ') : ''}`))),
      h('div', { class: 'sg-row muted ph-hint' }, 'Нет подходящего — впишите свой текст: после сохранения он появится в вариантах.'));
    box.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    placeList(box);
    box.querySelector('.sg-row.active')?.scrollIntoView({ block: 'nearest' });
  }
  function pick(x) { input.value = x.text; input.dispatchEvent(new Event('input', { bubbles: true })); close(); input.focus(); }
  let tmr;
  input.addEventListener('input', () => { clearTimeout(tmr); if (!input.value.trim()) { close(); return; } tmr = setTimeout(() => { if (document.activeElement === input) open(); }, 150); });
  input.addEventListener('focus', () => { updateCount(); if (!input.value.trim()) open(true); });
  input.addEventListener('blur', () => setTimeout(close, 150));
  input.addEventListener('keydown', (e) => {
    if (box.hidden) { if (e.key === 'ArrowDown' && e.altKey) { e.preventDefault(); open(true); } return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(shown.length - 1, active + 1); open(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(0, active - 1); open(); }
    else if (e.key === 'Enter' && shown[active] && !e.shiftKey) { e.preventDefault(); pick(shown[active]); }
    else if (e.key === 'Escape') { e.stopPropagation(); close(); }
    else if (e.key === 'Tab') close();
  });
  return { refresh: updateCount };
}
