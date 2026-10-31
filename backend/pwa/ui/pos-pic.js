import { PREFIX } from '../core/api.js';
import { h } from '../core/dom.js';
import { openZoom } from './gallery.js';

/**
 * Фото позиции/изделия: photo = { url, thumb } | null. Клик — крупно; фото нет (или битое) — «нет фото» в той же рамке.
 * size: 'sm' — 36 px (таблицы), 'lg' — 72 px (карточки, сравнение). Классы .pic / .pic-lg — screens.css.
 */
export function posPic(photo, size = 'lg') {
  const cls = 'pic' + (size === 'lg' ? ' pic-lg' : '');
  const none = () => h('span', { class: cls + ' empty mt-nopic', title: 'Фото нет' }, 'нет фото');
  if (!photo || !(photo.url || photo.thumb)) return none();
  const src = photo.thumb || photo.url;
  return h('button', { type: 'button', class: 'mt-picbtn', title: 'Открыть фото крупно', 'aria-label': 'Открыть фото крупно', onclick: (e) => { e.stopPropagation(); openZoom([{ url: photo.url || src }]); } },
    h('img', { class: cls, src: PREFIX + src, alt: '', loading: 'lazy', decoding: 'async', draggable: 'false', onerror: (e) => e.currentTarget.parentElement.replaceWith(none()) }));
}

/** Фото из полей lines-lookup: photoId / photoThumb (оригинала нет — крупно открывается миниатюра). */
export const posPicOf = (l, size = 'sm') => posPic(l?.photoThumb ? { url: l.photoThumb, thumb: l.photoThumb } : null, size);
