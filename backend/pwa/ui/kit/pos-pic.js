import { PREFIX } from '../../core/api.js';
import { h } from '../../core/dom.js';
import { openZoom } from './gallery.js';

/**
 * Фото позиции/изделия: photo = { url, thumb } | null. Клик — крупно; фото нет (или битое) — «нет фото» (битое — маленькой рамкой).
 * size: 'sm' — 36 px (таблицы), 'lg' — 72 px (карточки, сравнение). Классы .pic / .pic-lg — screens.css.
 */
export function posPic(photo, size = 'lg') {
  const cls = 'pic' + (size === 'lg' ? ' pic-lg' : '');
  const none = (c = cls) => h('span', { class: c + ' empty mt-nopic', title: 'Фото нет' }, 'нет фото');
  if (!photo || !(photo.url || photo.thumb)) return none();
  const src = photo.thumb || photo.url;
  // битый файл — маленькая рамка 'pic': строка не раздувается до 131 px (заказ 11-26, 2026-11-15)
  return h('button', { type: 'button', class: 'mt-picbtn', title: 'Открыть фото крупно', 'aria-label': 'Открыть фото крупно', onclick: (e) => { e.stopPropagation(); openZoom([{ url: photo.url || src }]); } },
    h('img', { class: cls, src: PREFIX + src, alt: '', loading: 'lazy', decoding: 'async', draggable: 'false', onerror: (e) => e.currentTarget.parentElement.replaceWith(none('pic')) }));
}

/** Фото из полей lines-lookup: photoId / photoThumb (оригинала нет — крупно открывается миниатюра). */
export const posPicOf = (l, size = 'sm') => posPic(l?.photoThumb ? { url: l.photoThumb, thumb: l.photoThumb } : null, size);
