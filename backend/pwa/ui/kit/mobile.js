import { h } from '../../core/dom.js';
import { catArt } from '../cat-art.js';

/**
 * kit «mobile» — мобильные рабочие экраны (склад ассистента; дальше — другие рабочие): крупно, по одному шагу, QR + кнопки.
 * Все размеры — CSS-переменные .m-screen в kit.css (--m-font, --m-title, --m-btn-h, --m-gap …): стандарт меняется в одном месте.
 * Экран собирается только из этих эталонов. Точка расширения QR: drill({ extra }) — сюда встанет кнопка «Сканировать».
 */
const nodes = (x) => [].concat(x ?? []).filter((n) => n !== null && n !== false && n !== '');

/** bigButton({ label, icon, tone: 'primary'|'neutral'|'danger', onClick, disabled }) → .btn.m-btn; async onClick — кнопка занята до конца (второе нажатие игнорируется); главная — лёгкая вибрация */
export function bigButton({ label, icon, tone = 'primary', onClick, disabled = false, aria, size = 'wide' } = {}) {
  const btn = h('button', { type: 'button', class: `btn m-btn m-${tone}${size === 'auto' ? ' m-auto' : size === 'sm' ? ' m-auto m-sm' : ''}`, disabled, 'aria-label': aria || null,
    onclick: async () => {
      if (btn.classList.contains('is-busy')) return;
      btn.classList.add('is-busy'); btn.disabled = true;
      if (tone === 'primary') navigator.vibrate?.(10);
      try { await onClick?.(); } finally { btn.classList.remove('is-busy'); btn.disabled = disabled; }
    } }, icon || null, label);
  return btn;
}

/** screen({ title, back, step: {n, of}, gear, body, foot, footHint }) → .m-screen: закреплённая шапка (Назад · шаг «n/of» · шестерёнка «Настройки»), заголовок, тело, закреплённый низ; footHint — только пока главная кнопка не готова */
export function screen({ title, back, step, gear, body, foot, footHint } = {}) {
  return h('div', { class: 'm-screen' },
    h('div', { class: 'm-head' },
      // главный экран (только настройки): название и «Настройки» — одной строкой
      gear && !back && !step ? h('div', { class: 'm-bar' }, title ? h('h1', null, title) : null, h('span', { class: 'm-grow' }),
        bigButton({ label: '⚙ Настройки', tone: 'neutral', size: 'sm', onClick: gear })) :
      back || step || gear ? h('div', { class: 'm-bar' }, back ? bigButton({ label: '‹ Назад', tone: 'neutral', size: 'sm', onClick: back }) : null,
        h('span', { class: 'm-grow' }),
        step ? h('div', { class: 'm-step', role: 'status', 'aria-label': `Шаг ${step.n} из ${step.of}` }, `${step.n}/${step.of}`) : null,
        gear ? h('button', { type: 'button', class: 'm-gear', 'aria-label': 'Настройки', onclick: gear }, '⚙') : null) : null,
      title && !(gear && !back && !step) ? h('h1', null, title) : null),
    h('div', { class: 'm-body' }, ...nodes(body)),
    foot || footHint ? h('div', { class: 'm-foot' }, footHint ? h('div', { class: 'm-unit', role: 'status' }, footHint) : null, foot) : null);
}

/** choice({ items: [{ value, label, hint }], onPick(item), empty, selected }) → крупный список выбора; больше 100 строк — порциями по 50 (догрузка при прокрутке) */
export function choice({ items = [], onPick, empty = 'Ничего нет', selected } = {}) {
  if (!items.length) return h('div', { class: 'm-empty' }, empty);
  const box = h('div', { class: 'm-choice', role: 'listbox' });
  const row = (it) => h('button', { type: 'button', class: 'm-item' + (selected !== undefined && it.value === selected ? ' m-on' : ''), role: 'option',
    'aria-selected': selected !== undefined ? String(it.value === selected) : null, onclick: () => onPick?.(it) },
  h('b', null, it.label), it.hint ? h('small', null, it.hint) : null);
  let shown = 0;
  const more = () => {
    box.querySelector('.m-more')?.remove();
    const next = items.slice(shown, shown + (items.length > 100 ? 50 : items.length));
    shown += next.length;
    box.append(...next.map(row));
    if (shown < items.length) {
      const tail = h('div', { class: 'm-more', 'aria-hidden': 'true' });
      box.append(tail);
      if (typeof IntersectionObserver === 'function') {
        const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { io.disconnect(); more(); } }, { rootMargin: '400px' });
        io.observe(tail);
      } else more();
    }
  };
  more();
  return box;
}

/** tiles({ items: [{ value, label, art }], onPick }) → крупные плитки по 2 в ряд с рисунком (art — SVG из ui/cat-art.js catArt(название) или иконка категории) */
export function tiles({ items = [], onPick, empty = 'Ничего нет', selected } = {}) {
  if (!items.length) return h('div', { class: 'm-empty' }, empty);
  return h('div', { class: 'm-tiles', role: 'listbox' }, ...items.map((it) => {
    const pic = h('span', { class: 'm-tile-art', 'aria-hidden': 'true' });
    if (it.art) pic.innerHTML = it.art; // разметку рисует код cat-art.js, данные в неё не подставляются
    return h('button', { type: 'button', class: 'm-tile' + (selected !== undefined && it.value === selected ? ' m-on' : '') + (it.art ? '' : ' m-plain'), role: 'option', onclick: () => onPick?.(it) }, it.art ? pic : null, h('b', null, it.label));
  }));
}
export { catArt };

/** feed({ items: [{ date, text, qty, unit, kind: 'out'|'in' }], loading, empty }) → лента плитками (не кликабельна); loading — скелет */
export function feed({ items = [], loading = false, empty = 'За 7 дней операций нет' } = {}) {
  if (loading) return h('div', { class: 'm-feed', 'aria-busy': 'true' }, ...[0, 1, 2].map(() => h('div', { class: 'm-skel' })));
  if (!items.length) return h('div', { class: 'm-empty' }, empty, h('br'), h('small', null, 'Здесь появятся ваши выдачи и приёмки за неделю.'));
  return h('div', { class: 'm-feed' }, ...items.map((it) => h('div', { class: 'm-fi m-fi-' + it.kind },
    h('span', { class: 'm-fi-date' }, it.date),
    h('span', { class: 'm-fi-what' }, (it.kind === 'in' ? '↑ Принято · ' : '↓ Выдано · ') + it.text),
    h('b', { class: 'm-fi-qty' }, `${it.qty} ${it.unit || ''}`.trim()))));
}

/** dateChoice({ onChange }) → { el, value() → ГГГГ-ММ-ДД } — «Сегодня / Вчера / Другая дата» крупными кнопками (другая — список последних 30 дней), без клавиатуры */
export function dateChoice({ onChange } = {}) {
  const iso = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const ago = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return iso(d); };
  const fmtD = (v) => v.split('-').reverse().join('.');
  let cur = ago(0); let other = false;
  const el = h('div', { class: 'm-date' });
  const paint = () => {
    const t = ago(0); const y = ago(1);
    const custom = cur !== t && cur !== y;
    const chip = (label, on, run) => h('button', { type: 'button', class: 'm-item m-chip' + (on ? ' m-on' : ''), 'aria-pressed': String(!!on), onclick: run }, h('b', null, label));
    const set = (v) => { cur = v; other = false; onChange?.(cur); paint(); };
    el.replaceChildren(
      h('div', { class: 'm-chips' }, chip('Сегодня', cur === t && !other, () => set(t)), chip('Вчера', cur === y && !other, () => set(y)),
        chip(custom ? fmtD(cur) : 'Другая дата', other || custom, () => { other = !other; paint(); })),
      other ? choice({ items: Array.from({ length: 30 }, (_, n) => ({ value: ago(n + 2), label: fmtD(ago(n + 2)) })), selected: cur, onPick: (o) => set(o.value) }) : null);
  };
  paint();
  return { el, value: () => cur };
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
    key('Сброс', () => { txt = ''; fresh = false; paint(); }, 'Очистить'),
    key('+10', () => { txt = String(Math.round(((Number.isFinite(num()) ? num() : 0) + 10) * 1000) / 1000).replace('.', ','); fresh = false; paint(); }, 'Прибавить десять'));
  const el = h('div', { class: 'm-qty-box' }, out,
    h('div', { class: 'm-unit' }, max != null ? `На складе: ${max} ${unit}`.trim() : unit),
    hint ? h('div', { class: 'm-unit' }, hint) : null, keys);
  return { el, value: () => (txt ? num() : NaN) };
}

/** textField({ label, placeholder, max }) → { el, value() } — многострочный текст крупно; единственное место, где на мобильном склада открывается системная клавиатура (исключение: заявка на новую позицию) */
export function textField({ label = '', placeholder = '', max = 500 } = {}) {
  const ta = h('textarea', { class: 'm-text', rows: 4, maxlength: max, placeholder, 'aria-label': label || placeholder });
  return { el: h('div', { class: 'm-text-box' }, label ? h('div', { class: 'm-unit' }, label) : null, ta), value: () => ta.value.trim() };
}

/** error(text, { onRetry }) → крупная ошибка; onRetry добавляет кнопку «Повторить» */
export const error = (text, { onRetry } = {}) => h('div', { class: 'm-error', role: 'alert' }, h('div', null, '⚠ ' + text), onRetry ? bigButton({ label: 'Повторить', tone: 'neutral', onClick: onRetry }) : null);

/** drill({ levels: [{ title, tiles, load(path) → Promise<[{ value, label, hint, art }]> }], onPick(item, path), empty }) → { el, up() }
 *  Пошаговые крупные списки без поля ввода: уровень за уровнем, на последнем выбор. up() — на уровень выше (false, если выше нет).
 *  title пустой — без подзаголовка; tiles — уровень плитками с рисунком. Больше 30 строк — буквенный указатель. extra — слот («Сканировать QR»). */
export function drill({ levels, onPick, extra, empty = 'Ничего нет' } = {}) {
  const el = h('div', { class: 'm-drill' });
  const path = [];
  const go = async () => {
    const lv = levels[path.length];
    el.replaceChildren(h('div', { class: 'm-empty' }, 'Загружаю…'));
    let items;
    try { items = await lv.load(path.map((p) => p.value)); } catch (e) { el.replaceChildren(error(e?.status ? (e.message || 'Не получилось.') : 'Нет связи. Ничего не потеряно — повторите, когда появится связь.', { onRetry: go })); return; }
    const list = h('div', { class: 'm-results' });
    const pick = (it) => { if (path.length + 1 < levels.length) { path.push(it); go(); } else onPick?.(it, [...path.map((p) => p.value), it.value]); };
    // фильтры длинного списка: первая буква и размер резьбы (М6, М8, М10 — из названий); оба вместе, выбранный подсвечен.
    // Размеры — только те, что есть у позиций выбранной буквы; выбранного размера нет — фильтр по размеру сбрасывается.
    const f = { letter: '', size: '' };
    const sizeOf = (i) => { const m = /(?:^|[\s,(])[MМ]\s?(\d+(?:[.,]\d+)?)/.exec(String(i.label)); return m ? 'М' + m[1].replace(',', '.') : ''; };
    const byLetter = (i) => !f.letter || String(i.label).trim().toUpperCase().startsWith(f.letter);
    const long = items.length > 30;
    const letters = long ? [...new Set(items.map((i) => String(i.label).trim().charAt(0).toUpperCase()))].sort((x, y) => x.localeCompare(y, 'ru')) : [];
    const sizesOf = (arr) => [...new Set(arr.map(sizeOf).filter(Boolean))].sort((x, y) => parseFloat(x.slice(1)) - parseFloat(y.slice(1)));
    let chips = [];
    const chip = (label, key, val) => { const b = bigButton({ label, tone: 'neutral', size: 'sm', onClick: () => { f[key] = val; paint(); } }); b.dataset.key = key; b.dataset.val = val; chips.push(b); return b; };
    const row = (aria, key, vals) => h('div', { class: 'm-letters', role: 'group', 'aria-label': aria }, chip(key === 'size' ? 'Все размеры' : 'Все', key, ''), ...vals.map((v) => chip(v, key, v)));
    const letterRow = letters.length ? row('Буква', 'letter', letters) : null;
    const sizeBox = h('div');
    const paint = () => {
      const sizes = long ? sizesOf(items.filter(byLetter)) : [];
      if (f.size && !sizes.includes(f.size)) f.size = '';
      chips = chips.filter((b) => b.dataset.key !== 'size');
      sizeBox.replaceChildren(...(sizes.length > 1 ? [row('Размер', 'size', sizes)] : []));
      chips.forEach((b) => b.classList.toggle('m-on', f[b.dataset.key] === b.dataset.val));
      list.replaceChildren((lv.tiles ? tiles : choice)({ items: items.filter((i) => byLetter(i) && (!f.size || sizeOf(i) === f.size)), empty, onPick: pick }));
    };
    el.replaceChildren(...nodes(extra), lv.title ? h('h2', { class: 'm-sub' }, lv.title) : null, letterRow, sizeBox, list);
    paint();
  };
  go();
  return { el, up: () => { if (!path.length) return false; path.pop(); go(); return true; } };
}

/** done({ text, again, home }) → блок «Выполнено» (для рабочих экранов склада вместо него — крупное уведомление и возврат на главный) */
export function done({ text, again, home } = {}) {
  return h('div', { class: 'm-done-box' }, h('div', { class: 'm-done', role: 'status' }, text), again ? bigButton({ label: again.label, onClick: again.onClick }) : null, home ? bigButton({ label: home.label, tone: 'neutral', onClick: home.onClick }) : null);
}

/** scanSupported() — есть ли в браузере чтение QR (BarcodeDetector) и камера */
export const scanSupported = () => typeof window !== 'undefined' && 'BarcodeDetector' in window && !!navigator.mediaDevices?.getUserMedia;

/** scan({ onCode(text), onCancel(), hint }) → { el, stop() } — экран камеры: крупная рамка, «Наведите на код», «Отмена».
 *  Найден код — короткая вибрация, камера выключается, вызывается onCode. Нет камеры/доступа — крупная ошибка и «Отмена» (ручной выбор остаётся). */
export function scan({ onCode, onCancel, hint = 'Наведите на код' } = {}) {
  let stream = null; let timer = null; let stopped = false;
  const video = h('video', { class: 'm-video', autoplay: true, playsinline: true, muted: true });
  const msg = h('div', { class: 'm-unit', role: 'status' }, 'Нужна камера, чтобы считать код');
  const stop = () => { stopped = true; clearInterval(timer); stream?.getTracks().forEach((t) => t.stop()); stream = null; };
  const cancel = bigButton({ label: 'Отмена', tone: 'neutral', onClick: () => { stop(); onCancel?.(); } });
  const el = h('div', { class: 'm-scan' }, h('div', { class: 'm-frame' }, video, h('div', { class: 'm-aim' })), msg, cancel);
  (async () => {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      if (stopped) { stop(); return; }
      video.srcObject = stream; await video.play().catch(() => {});
      msg.textContent = hint;
      const det = new window.BarcodeDetector({ formats: ['qr_code'] });
      let busy = false;
      timer = setInterval(async () => {
        if (busy || stopped || video.readyState < 2) return;
        busy = true;
        try {
          const found = await det.detect(video);
          const text = found?.[0]?.rawValue;
          if (text && !stopped) { stop(); navigator.vibrate?.(120); onCode?.(text); }
        } catch { /* кадр не прочитался — следующий */ } finally { busy = false; }
      }, 250);
    } catch {
      stop(); el.replaceChildren(error('Нет доступа к камере. Разрешите камеру в настройках браузера или выберите позицию из списка.'), cancel);
    }
  })();
  return { el, stop };
}

export const mobile = { screen, bigButton, choice, tiles, feed, dateChoice, qty, textField, drill, done, error, scan, scanSupported };
