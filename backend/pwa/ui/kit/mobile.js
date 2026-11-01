import { h } from '../../core/dom.js';

/**
 * kit «mobile» — мобильные рабочие экраны (склад ассистента; дальше — другие рабочие): крупно, по одному шагу, QR + кнопки.
 * Все размеры — CSS-переменные .m-screen в kit.css (--m-font, --m-title, --m-btn-h, --m-gap …): стандарт меняется в одном месте.
 * Экран собирается только из этих эталонов. Точка расширения QR: search({ extra }) — сюда встанет кнопка «Сканировать».
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

/** qty({ value, unit, max, step, hint }) → { el, value() } — крупные +/− и поле с цифровой клавиатурой */
export function qty({ value = 1, unit = '', max, step = 1, hint } = {}) {
  const input = h('input', { type: 'text', inputmode: 'decimal', 'aria-label': 'Количество', value: String(value) });
  const num = () => parseFloat(String(input.value).replace(',', '.').replace(/\s/g, ''));
  const put = (n) => { const v = Math.max(0, Math.round(n * 1000) / 1000); input.value = String(v).replace('.', ','); };
  const cur = () => (Number.isFinite(num()) ? num() : 0);
  const el = h('div', { class: 'm-qty-box' },
    h('div', { class: 'm-qty' },
      bigButton({ label: '−', aria: 'Меньше', tone: 'neutral', onClick: () => put(cur() - step) }),
      input,
      bigButton({ label: '+', aria: 'Больше', tone: 'neutral', onClick: () => put(cur() + step) })),
    Number.isInteger(step) ? bigButton({ label: '+10', aria: 'Прибавить десять', tone: 'neutral', onClick: () => put(cur() + 10) }) : null,
    h('div', { class: 'm-unit' }, `${unit ? 'Единица: ' + unit : ''}${max != null ? (unit ? ' · ' : '') + 'на складе: ' + max : ''}`),
    hint ? h('div', { class: 'm-unit' }, hint) : null);
  return { el, value: num, input };
}

/** error(text) → крупное сообщение об ошибке */
/** error(text, { onRetry }) → крупная ошибка; onRetry добавляет кнопку «Повторить» */
export const error = (text, { onRetry } = {}) => h('div', { class: 'm-error', role: 'alert' }, h('div', null, '⚠ ' + text), onRetry ? bigButton({ label: 'Повторить', tone: 'neutral', onClick: onRetry }) : null);

/** search({ placeholder, source(q) → Promise<[{ value, label, hint }]>, onPick, extra }) → крупный поиск со списком результатов */
export function search({ placeholder = 'Поиск', source, onPick, extra, empty = 'Ничего не найдено' } = {}) {
  const input = h('input', { type: 'search', placeholder, 'aria-label': placeholder, autocomplete: 'off' });
  const list = h('div', { class: 'm-results' });
  let t; let seq = 0;
  const run = async () => {
    const q = input.value.trim(); const my = ++seq;
    if (q.length < 2) { list.replaceChildren(); return; }
    list.replaceChildren(h('div', { class: 'm-empty' }, 'Ищу…'));
    try {
      const items = await source(q);
      if (my === seq) list.replaceChildren(choice({ items, onPick, empty }));
    } catch (e) { if (my === seq) list.replaceChildren(error(e?.message || 'Не удалось выполнить поиск. Проверьте связь.')); }
  };
  input.addEventListener('input', () => { clearTimeout(t); t = setTimeout(run, 300); });
  return h('div', { class: 'm-search' }, ...nodes(extra), input, list);
}

/** done({ text, again: { label, onClick }, home: { label, onClick } }) → экран «Выполнено» */
export function done({ text, again, home } = {}) {
  return h('div', { class: 'm-done-box' }, h('div', { class: 'm-done', role: 'status' }, text), again ? bigButton({ label: again.label, onClick: again.onClick }) : null, home ? bigButton({ label: home.label, tone: 'neutral', onClick: home.onClick }) : null);
}

export const mobile = { screen, bigButton, choice, qty, search, done, error };
