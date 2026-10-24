/** ШП: ручка ширины боковой панели (DESIGN §4 «Ручка ширины»). Одна на все панели: меню, правая панель, фильтры.
 *  makeResizable(host, { prefKey, edge, label }) — ручка у края host: edge 'right' — правый край (меню, фильтры),
 *  'left' — левый (правая панель). Пределы, стандарт и CSS-переменная — в core/prefs.js (одна таблица на всё).
 *  Мышь/касание: pointer-события с захватом; во время движения меняется только CSS-переменная (в rAF),
 *  запись — при отпускании. Двойной щелчок и Enter — стандарт. ←/→ ±16 px, Shift ±64, Home/End — min/max. */
import { h } from '../core/dom.js';
import { commitPref, limits, livePref } from '../core/prefs.js';

const HINT = 'Потяните, чтобы изменить ширину. Двойной щелчок — по умолчанию';

export function makeResizable(host, { prefKey, edge = 'right', label = 'Ширина панели' }) {
  const el = h('div', { class: 'resizer rz-' + edge, role: 'separator', 'aria-orientation': 'vertical', 'aria-label': label, tabindex: '0', title: HINT });
  const width = () => Math.round(host.getBoundingClientRect().width);
  const aria = (w = width()) => {
    const { min, max } = limits(prefKey);
    el.setAttribute('aria-valuemin', String(min)); el.setAttribute('aria-valuemax', String(max)); el.setAttribute('aria-valuenow', String(w));
  };
  const fit = (w) => { const { min, max } = limits(prefKey); return Math.round(Math.min(Math.max(w, min), max)); };
  // edge 'left': тянем влево — панель шире
  const sign = edge === 'left' ? -1 : 1;

  let drag = null; let raf = 0; let next = 0;
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    drag = { x: e.clientX, w: width(), moved: false };
    next = drag.w;
    document.body.classList.add('is-resizing'); el.classList.add('is-active');
  });
  el.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    if (Math.abs(dx) > 2) drag.moved = true;
    next = fit(drag.w + sign * dx);
    if (!raf) raf = requestAnimationFrame(() => { raf = 0; livePref(prefKey, next); aria(next); });
  });
  const end = () => {
    if (!drag) return;
    const moved = drag.moved; drag = null;
    cancelAnimationFrame(raf); raf = 0;
    document.body.classList.remove('is-resizing'); el.classList.remove('is-active');
    if (moved) commitPref(prefKey, next);
    aria();
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener('lostpointercapture', end);
  el.addEventListener('dblclick', (e) => { e.preventDefault(); commitPref(prefKey, null); aria(); });
  el.addEventListener('keydown', (e) => {
    const { min, max } = limits(prefKey);
    let w;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') w = fit(width() + (e.key === 'ArrowRight' ? 1 : -1) * sign * (e.shiftKey ? 64 : 16));
    else if (e.key === 'Home') w = min;
    else if (e.key === 'End') w = max;
    else if (e.key === 'Enter') w = null;
    else return;
    e.preventDefault(); e.stopPropagation(); // стрелки не уходят в список (↑/↓, ←/→ разделов)
    commitPref(prefKey, w);
    requestAnimationFrame(() => aria());
  });
  el.addEventListener('focus', () => aria());
  el.addEventListener('pointerenter', () => aria());
  host.append(el);
  return el;
}
