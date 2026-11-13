import { h } from '../core/dom.js';
import { pick, select, button, enhanceSelect } from './kit/index.js';

const ALL = '__all';

/**
 * Типы паспорта галочками-чипами вместо строки кодов «TRN, WRK» (общий кусочек справочников: тексты, элементы,
 * материалы, способы установки). Первый чип «Для всех» — выбран: остальные гаснут (значение пусто = для всех).
 *   catChips({ options: [{ code, name }], value: 'TRN,WRK' | [...], all?: bool, label?, later?: [коды, которых не предлагаем, если не выбраны] })
 *   → { el, value (строка кодов; пусто при «Для всех»), all (bool), empty (не выбрано ничего), focus }
 * Коды, которых нет в options (старые), остаются отдельными чипами — ничего не теряем. Событие change всплывает от el.
 */
export function catChips({ options, value = '', all, label = 'Категории', allLabel = 'Для всех', later = [] }) {
  const parse = (v) => (Array.isArray(v) ? v : String(v || '').split(/[,;\s]+/)).map(String).filter(Boolean);
  const cur = new Set(parse(value));
  const isAll0 = all === undefined ? cur.size === 0 : !!all;
  const known = new Set(options.map((o) => String(o.code)));
  const list = [...options.filter((o) => !later.includes(String(o.code)) || cur.has(String(o.code))), ...[...cur].filter((c) => !known.has(c)).map((c) => ({ code: c, name: c }))];
  const tp = pick({ mode: 'tags', label, value: isAll0 ? [ALL] : [...cur], options: [{ value: ALL, label: allLabel, sub: '' }, ...list.map((o) => ({ value: String(o.code), label: o.name }))] });
  let was = new Set(JSON.parse(tp.value));
  tp.el.classList.add('cat-chips');
  tp.el.addEventListener('change', () => { // «Для всех» и отдельные категории взаимно исключают друг друга
    const now = new Set(JSON.parse(tp.value));
    if (now.has(ALL) && (!was.has(ALL) || now.size === 1)) now.clear(), now.add(ALL);
    else now.delete(ALL);
    was = now; tp.value = JSON.stringify([...now]);
  });
  const codes = () => JSON.parse(tp.value).filter((c) => c !== ALL);
  const isAll = () => JSON.parse(tp.value).includes(ALL);
  return {
    el: tp.el,
    get value() { return isAll() ? '' : codes().join(','); },
    get all() { return isAll(); },
    get empty() { return !isAll() && !codes().length; },
    focus: tp.focus,
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
  const cur = String(value || '').split(/[,;\s]+/).filter(Boolean);
  const known = new Set(options.map((o) => String(o.code)));
  const list = [...options, ...cur.filter((c) => !known.has(c)).map((c) => ({ code: c, name: c }))];
  const tp = pick({ mode: 'tags', label, value: cur, options: list.map((o) => ({ value: String(o.code), label: o.name, sub: o.group || '' })) });
  if (!options.length) tp.el.prepend(h('span', { class: 'muted' }, 'Категорий нет. «Справочники → Категории» — добавьте категорию материала.'));
  tp.el.classList.add('cat-chips');
  let was = new Set(cur);
  if (!multiple) tp.el.addEventListener('change', () => {
    const now = JSON.parse(tp.value); const fresh = now.filter((c) => !was.has(c));
    const keep = fresh.length ? [fresh[0]] : now.slice(0, 1);
    was = new Set(keep); tp.value = JSON.stringify(keep);
  });
  return { el: tp.el, get value() { return JSON.parse(tp.value).join(','); }, focus: tp.focus };
}

/** Поле формы (type: 'widget') «выбор из справочника»: в read() — JSON-строка кодов через запятую. */
export function refChipsField(options, { label, value, multiple = true } = {}) {
  const c = refChips({ options, value, multiple, label });
  return { el: c.el, get value() { return JSON.stringify(c.value); }, set value(v) { void v; }, focus: c.focus };
}

const elementIds = (v) => { if (Array.isArray(v)) return v.map(String); try { return JSON.parse(v || '[]').map(String); } catch { return []; } };
export function passportKindElements(options, value, label) {
  const picked = new Set(elementIds(value));
  const el = h('div');
  const chosen = h('div');
  const picker = select({ label, options: [['', 'Найти элемент…'], ...options.map((o) => [String(o.value), o.label])],
    onChange: (id) => {
      picker.value = '';
      if (!id || picked.size >= 3 || picked.has(id)) return;
      picked.add(id);
      change();
    } });
  const paint = () => {
    chosen.replaceChildren(...[...picked].map((id) => button({
      label: `${options.find((o) => String(o.value) === id)?.label || 'Сохранённый элемент'} ×`,
      size: 'S', title: 'Убрать элемент', onClick: () => { picked.delete(id); change(); },
    })));
  };
  const change = () => { paint(); el.dispatchEvent(new Event('change', { bubbles: true })); };
  el.append(picker, chosen);
  enhanceSelect(picker, { force: true });
  paint();
  return { el, get value() { return JSON.stringify([...picked]); }, set value(v) { picked.clear(); for (const id of elementIds(v)) picked.add(id); paint(); } };
}
