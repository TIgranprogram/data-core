import { h } from '../../core/dom.js';

/**
 * kit «mobile» — мобильные рабочие экраны (склад ассистента; дальше — другие рабочие): крупно, по одному шагу, QR + кнопки.
 * Все размеры — CSS-переменные .m-screen в kit.css (--m-font, --m-title, --m-btn-h, --m-gap …): стандарт меняется в одном месте.
 * Экран собирается только из этих эталонов. Точка расширения QR: drill({ extra }) — сюда встанет кнопка «Сканировать».
 */
const nodes = (x) => [].concat(x ?? []).filter((n) => n !== null && n !== false && n !== '');

/** bigButton({ label, icon, tone: 'primary'|'neutral'|'danger', onClick, disabled }) → .btn.m-btn; async onClick — кнопка занята до конца */
export function bigButton({ label, icon, tone = 'primary', onClick, disabled = false, aria, size = 'wide' } = {}) {
  const btn = h('button', { type: 'button', class: `btn m-btn m-${tone}${size === 'auto' ? ' m-auto' : ''}`, disabled, 'aria-label': aria || null,
    onclick: async () => {
      if (btn.classList.contains('is-busy')) return;
      btn.classList.add('is-busy'); btn.disabled = true;
      try { await onClick?.(); } finally { btn.classList.remove('is-busy'); btn.disabled = disabled; }
    } }, icon || null, label);
  return btn;
}

/** screen({ title, back, step: {n, of}, body, foot, footHint }) → .m-screen: «Шаг N из M», заголовок, крупная «Назад», тело; foot — главная кнопка, закреплена внизу; footHint — «что сделать» */
export function screen({ title, back, step, body, foot, footHint } = {}) {
  return h('div', { class: 'm-screen' },
    h('div', { class: 'm-head' },
      back || step ? h('div', { class: 'm-bar' }, back ? bigButton({ label: '‹ Назад', tone: 'neutral', size: 'auto', onClick: back }) : null, step ? h('div', { class: 'm-step', role: 'status' }, `Шаг ${step.n} из ${step.of}`) : null) : null,
      h('h1', null, title)),
    ...nodes(body),
    foot || footHint ? h('div', { class: 'm-foot' }, footHint ? h('div', { class: 'm-unit', role: 'status' }, footHint) : null, foot) : null);
}

/** choice({ items: [{ value, label, hint }], onPick(item), empty }) → крупный список выбора */
export function choice({ items = [], onPick, empty = 'Ничего нет' } = {}) {
  if (!items.length) return h('div', { class: 'm-empty' }, empty);
  return h('div', { class: 'm-choice', role: 'listbox' },
    ...items.map((it) => h('button', { type: 'button', class: 'm-item', role: 'option', onclick: () => onPick?.(it) },
      h('b', null, it.label), it.hint ? h('small', null, it.hint) : null)));
}

/** qty({ value, unit, max, step, hint }) → { el, value() } — число крупно и своя цифровая панель (системная клавиатура не открывается) */
export function qty({ value = 1, unit = '', max, hint } = {}) {
  let txt = String(value).replace('.', ','); let fresh = true;
  const out = h('div', { class: 'm-num', role: 'status', 'aria-live': 'polite' }, txt);
  const num = () => parseFloat(txt.replace(',', '.'));
  const paint = () => { out.textContent = txt || '0'; };
  const key = (label, run, aria) => bigButton({ label, aria, tone: 'neutral', onClick: run });
  const digit = (d) => key(d, () => { txt = fresh ? d : (txt === '0' ? d : txt + d); fresh = false; paint(); });
  const keys = h('div', { class: 'm-keys' },
    ...'123456789'.split('').map(digit),
    key(',', () => { if (fresh) txt = '0'; if (!txt.includes(',')) txt += ','; fresh = false; paint(); }, 'Запятая'),
    digit('0'),
    key('⌫', () => { txt = fresh ? '' : txt.slice(0, -1); fresh = false; paint(); }, 'Стереть'),
    key('Очистить', () => { txt = ''; fresh = false; paint(); }),
    key('+10', () => { txt = String(Math.round(((Number.isFinite(num()) ? num() : 0) + 10) * 1000) / 1000).replace('.', ','); fresh = false; paint(); }, 'Прибавить десять'));
  const el = h('div', { class: 'm-qty-box' }, out,
    h('div', { class: 'm-unit' }, (unit ? 'Единица: ' + unit : '') + (max != null ? (unit ? ' · ' : '') + 'на складе: ' + max : '')),
    hint ? h('div', { class: 'm-unit' }, hint) : null, keys);
  return { el, value: () => (txt ? num() : NaN) };
}

/** error(text) → крупное сообщение об ошибке */
/** error(text, { onRetry }) → крупная ошибка; onRetry добавляет кнопку «Повторить» */
export const error = (text, { onRetry } = {}) => h('div', { class: 'm-error', role: 'alert' }, h('div', null, '⚠ ' + text), onRetry ? bigButton({ label: 'Повторить', tone: 'neutral', onClick: onRetry }) : null);

/** drill({ levels: [{ title, load(path) → Promise<[{ value, label, hint }]> }], onPick(item, path), empty }) → { el, up() }
 *  Пошаговые крупные списки без поля ввода: уровень за уровнем, на последнем выбор. up() — на уровень выше (false, если выше нет).
 *  Больше 30 строк — буквенный указатель кнопками. extra — слот (кнопка «Сканировать», когда появится сканер). */
export function drill({ levels, onPick, extra, empty = 'Ничего нет' } = {}) {
  const el = h('div', { class: 'm-drill' });
  const path = [];
  const go = async () => {
    const lv = levels[path.length];
    el.replaceChildren(h('div', { class: 'm-empty' }, 'Загружаю…'));
    let items;
    try { items = await lv.load(path.map((p) => p.value)); } catch (e) { el.replaceChildren(error(e?.status ? (e.message || 'Не получилось.') : 'Нет связи. Ничего не потеряно — повторите, когда появится связь.', { onRetry: go })); return; }
    const list = h('div', { class: 'm-results' });
    const paint = (letter) => list.replaceChildren(choice({ items: letter ? items.filter((i) => String(i.label).trim().toUpperCase().startsWith(letter)) : items,
      empty, onPick: (it) => { if (path.length + 1 < levels.length) { path.push(it); go(); } else onPick?.(it, [...path.map((p) => p.value), it.value]); } }));
    const letters = items.length > 30 ? [...new Set(items.map((i) => String(i.label).trim().charAt(0).toUpperCase()))].sort((x, y) => x.localeCompare(y, 'ru')) : [];
    paint();
    el.replaceChildren(...nodes(extra), h('h2', { class: 'm-sub' }, lv.title),
      letters.length ? h('div', { class: 'm-letters', role: 'group', 'aria-label': 'Буква' }, bigButton({ label: 'Все', tone: 'neutral', size: 'auto', onClick: () => paint() }), ...letters.map((l) => bigButton({ label: l, tone: 'neutral', size: 'auto', onClick: () => paint(l) }))) : null, list);
  };
  go();
  return { el, up: () => { if (!path.length) return false; path.pop(); go(); return true; } };
}

/** done({ text, again: { label, onClick }, home: { label, onClick } }) → экран «Выполнено» */
export function done({ text, again, home } = {}) {
  return h('div', { class: 'm-done-box' }, h('div', { class: 'm-done', role: 'status' }, text), again ? bigButton({ label: again.label, onClick: again.onClick }) : null, home ? bigButton({ label: home.label, tone: 'neutral', onClick: home.onClick }) : null);
}

export const mobile = { screen, bigButton, choice, qty, drill, done, error };
