import { h } from '../core/dom.js';

/**
 * Категории паспорта галочками-чипами вместо строки кодов «TRN, WRK» (общий кусочек справочников: тексты, элементы,
 * материалы, способы установки). Первый чип «Для всех» — выбран: остальные гаснут (значение пусто = для всех).
 *   catChips({ options: [{ code, name }], value: 'TRN,WRK' | [...], all?: bool, label?, later?: [коды, которых не предлагаем, если не выбраны] })
 *   → { el, value (строка кодов; пусто при «Для всех»), all (bool), empty (не выбрано ничего), focus }
 * Коды, которых нет в options (старые), остаются отдельными чипами — ничего не теряем. Событие change всплывает от el.
 */
export function catChips({ options, value = '', all, label = 'Категории', allLabel = 'Для всех', later = [] }) {
  const parse = (v) => (Array.isArray(v) ? v : String(v || '').split(/[,;\s]+/)).map(String).filter(Boolean);
  const cur = new Set(parse(value));
  let isAll = all === undefined ? cur.size === 0 : !!all;
  const known = new Set(options.map((o) => String(o.code)));
  const list = [...options.filter((o) => !later.includes(String(o.code)) || cur.has(String(o.code))), ...[...cur].filter((c) => !known.has(c)).map((c) => ({ code: c, name: c }))];
  const box = h('div', { class: 'tag-pick cat-chips', role: 'group', 'aria-label': label });
  const fire = () => box.dispatchEvent(new Event('change', { bubbles: true }));
  const allBtn = h('button', { type: 'button', class: 'tag', 'aria-pressed': 'false', title: 'Подходит любой категории', onclick: () => { isAll = !isAll; if (isAll) cur.clear(); paint(); fire(); } }, allLabel);
  const btns = list.map((o) => h('button', { type: 'button', class: 'tag', 'aria-pressed': 'false', 'data-code': String(o.code), onclick: () => {
    if (isAll) { isAll = false; cur.clear(); }
    cur.has(String(o.code)) ? cur.delete(String(o.code)) : cur.add(String(o.code));
    paint(); fire();
  } }, o.name));
  function paint() {
    allBtn.classList.toggle('active', isAll); allBtn.setAttribute('aria-pressed', String(isAll));
    for (const b of btns) { const on = cur.has(b.dataset.code); b.classList.toggle('active', on && !isAll); b.setAttribute('aria-pressed', String(on && !isAll)); b.classList.toggle('dim', isAll); }
  }
  box.append(allBtn, ...btns);
  paint();
  return {
    el: box,
    get value() { return isAll ? '' : [...cur].join(','); },
    get all() { return isAll; },
    get empty() { return !isAll && !cur.size; },
    focus: () => allBtn.focus(),
  };
}

/** Поле формы (type: 'widget') «Категории»: в read() приходит строка кодов (в виде JSON), пусто = для всех. */
export function catChipsField(options, { label = 'Категории', value, later } = {}) {
  const c = catChips({ options, value, label, later });
  return { el: c.el, get value() { return JSON.stringify(c.value); }, set value(v) { void v; }, focus: c.focus };
}

/**
 * Выбор записей справочника по названию (вместо строки кодов): галочки-чипы, значение — коды через запятую.
 *   refChips({ options: [{ code, name, group? }], value, multiple = true, label })
 * Коды, которых нет в списке (старые), остаются отдельными чипами. Событие change всплывает от el.
 */
export function refChips({ options, value = '', multiple = true, label = 'Выбор' }) {
  const cur = new Set(String(value || '').split(/[,;\s]+/).filter(Boolean));
  const known = new Set(options.map((o) => String(o.code)));
  const list = [...options, ...[...cur].filter((c) => !known.has(c)).map((c) => ({ code: c, name: c }))];
  const box = h('div', { class: 'tag-pick cat-chips', role: 'group', 'aria-label': label });
  const btns = list.map((o) => h('button', { type: 'button', class: 'tag', 'aria-pressed': 'false', 'data-code': String(o.code), title: o.group || '', onclick: () => {
    const c = String(o.code);
    if (cur.has(c)) cur.delete(c); else { if (!multiple) cur.clear(); cur.add(c); }
    paint(); box.dispatchEvent(new Event('change', { bubbles: true }));
  } }, o.group ? `${o.name} · ${o.group}` : o.name));
  function paint() { for (const b of btns) { const on = cur.has(b.dataset.code); b.classList.toggle('active', on); b.setAttribute('aria-pressed', String(on)); } }
  if (!list.length) box.append(h('span', { class: 'muted' }, 'Список пока пуст'));
  box.append(...btns);
  paint();
  return { el: box, get value() { return [...cur].join(','); }, focus: () => btns[0]?.focus() };
}

/** Поле формы (type: 'widget') «выбор из справочника»: в read() — JSON-строка кодов через запятую. */
export function refChipsField(options, { label, value, multiple = true } = {}) {
  const c = refChips({ options, value, multiple, label });
  return { el: c.el, get value() { return JSON.stringify(c.value); }, set value(v) { void v; }, focus: c.focus };
}
