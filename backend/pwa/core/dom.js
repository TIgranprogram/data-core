/** Создание элементов без innerHTML (CANON §3: данные пользователя — только textContent).
 *  h('button', { class: 'btn', onclick }, 'Текст', childNode, [массив детей]) */
export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  let value;
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'value') value = v; // после детей: у <select> сначала нужны <option>
    else if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  append(el, children);
  if (value !== undefined) el.value = String(value);
  return el;
}

function append(el, kids) {
  for (const c of kids) {
    if (c === undefined || c === null || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

// Нативные append/prepend/replaceChildren/before/after печатают null/undefined/false текстом («nullnull»).
// Оборачиваем один раз: пустые аргументы отбрасываются, как в h().
const empty = (x) => x === undefined || x === null || x === false;
for (const [proto, names] of [[Element.prototype, ['append', 'prepend', 'replaceChildren', 'before', 'after']], [DocumentFragment.prototype, ['append', 'prepend', 'replaceChildren']]]) {
  for (const n of names) {
    const orig = proto[n];
    if (!orig || orig.__clean) continue;
    const w = function (...a) { return orig.apply(this, a.filter((x) => !empty(x))); };
    w.__clean = true;
    proto[n] = w;
  }
}

/** fill(el, ...kids) — replaceChildren без пустых (null/undefined/false). */
export const fill = (el, ...kids) => { el.replaceChildren(...kids.flat().filter((x) => !empty(x))); return el; };

export const $ = (sel, root = document) => root.querySelector(sel);

/** Отложить вызов (поиск при наборе). */
export function debounce(fn, ms = 300) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
