import { PREFIX } from '../core/api.js';
import { h } from '../core/dom.js';

/**
 * Карусель фото `.pgal` (DESIGN §4): крупное 4:3, стрелки ‹ ›, счётчик «2 / 5», лента миниатюр, свайп, ←/→, клик — крупно.
 * pics: [{ url, thumb? }]. onAdd — если задан, последняя плитка ленты «+ Фото» (или единственная плитка, когда фото нет).
 * Возвращает { el, show(i) }.
 */
export function carousel(pics, { onAdd, emptyText = 'Добавить фото' } = {}) {
  if (!pics.length) {
    return { el: onAdd ? h('button', { type: 'button', class: 't-pic-none pgal-empty', onclick: onAdd }, '+ ' + emptyText) : null, show() {} };
  }
  let cur = 0;
  const big = h('img', { class: 'pgal-img', alt: 'Фото', decoding: 'async', draggable: 'false', tabindex: 0, title: 'Открыть крупно' });
  const count = h('span', { class: 'pgal-n', 'aria-live': 'polite' });
  const many = pics.length > 1;
  const step = (d) => show((cur + d + pics.length) % pics.length);
  const arrow = (d, label, ch) => (many ? h('button', { type: 'button', class: 'btn btn-icon pgal-arrow ' + (d < 0 ? 'prev' : 'next'), 'aria-label': label, onclick: (e) => { e.stopPropagation(); step(d); } }, ch) : null);
  const thumbs = pics.map((p, i) => h('button', { type: 'button', class: 'pgal-th', 'aria-label': `Фото ${i + 1}`, onclick: () => show(i) },
    h('img', { src: PREFIX + (p.thumb || p.url), alt: '', loading: 'lazy', decoding: 'async', draggable: 'false' })));
  const strip = many || onAdd ? h('div', { class: 'pgal-strip' }, ...(many ? thumbs : []), onAdd ? h('button', { type: 'button', class: 'pgal-th pgal-add', onclick: onAdd, 'aria-label': 'Добавить фото' }, '+ Фото') : null) : null;
  function show(i) {
    cur = (i + pics.length) % pics.length;
    big.src = PREFIX + pics[cur].url;
    count.textContent = many ? `${cur + 1} / ${pics.length}` : '';
    thumbs.forEach((t, j) => { if (j === cur) { t.setAttribute('aria-current', 'true'); t.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }); } else t.removeAttribute('aria-current'); });
  }
  big.addEventListener('click', () => zoom(pics, cur, show));
  big.addEventListener('keydown', (e) => { if (e.key === 'Enter') zoom(pics, cur, show); });
  const stage = h('div', { class: 'pgal-stage' }, big, arrow(-1, 'Предыдущее фото', '‹'), arrow(1, 'Следующее фото', '›'), many ? count : null);
  const el = h('div', { class: 'pgal', role: 'region', 'aria-label': 'Фото', tabindex: -1 }, stage, strip);
  let x0 = null;
  stage.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; }, { passive: true });
  stage.addEventListener('touchend', (e) => { if (x0 === null || !many) return; const dx = e.changedTouches[0].clientX - x0; x0 = null; if (Math.abs(dx) > 40) step(dx < 0 ? 1 : -1); }, { passive: true });
  el.addEventListener('keydown', (e) => { if (!many || e.target.closest('textarea,input')) return; if (e.key === 'ArrowLeft') { step(-1); e.preventDefault(); } else if (e.key === 'ArrowRight') { step(1); e.preventDefault(); } });
  show(0);
  return { el, show };
}

/** Открыть список фото крупно (без карусели). */
export function openZoom(pics, start = 0) { zoom(pics, start, () => {}); }

/** Крупно на весь экран, со стрелками; синхронизирует выбранное фото с каруселью. */
function zoom(pics, start, sync) {
  let cur = start;
  const img = h('img', { src: PREFIX + pics[cur].url, alt: '' });
  const go = (d) => { cur = (cur + d + pics.length) % pics.length; img.src = PREFIX + pics[cur].url; sync(cur); };
  const close = (e) => {
    if (e.type === 'keydown') {
      if (e.key === 'ArrowLeft' && pics.length > 1) go(-1); else if (e.key === 'ArrowRight' && pics.length > 1) go(1); else if (e.key !== 'Escape') return;
      if (e.key !== 'Escape') { e.stopPropagation(); return; }
    }
    box.remove(); document.removeEventListener('keydown', close, true); e.stopPropagation?.();
  };
  const arrow = (d, label, ch) => h('button', { type: 'button', class: 'btn btn-icon pgal-arrow ' + (d < 0 ? 'prev' : 'next'), 'aria-label': label, onclick: (e) => { e.stopPropagation(); go(d); } }, ch);
  const box = h('div', { class: 'lightbox', role: 'dialog', 'aria-label': 'Фото', onclick: close }, img, pics.length > 1 ? arrow(-1, 'Предыдущее фото', '‹') : null, pics.length > 1 ? arrow(1, 'Следующее фото', '›') : null);
  document.addEventListener('keydown', close, true);
  document.body.append(box);
}
