import { PREFIX } from '../../core/api.js';
import { h } from '../../core/dom.js';

/** Фото записи: большое + миниатюры; клик — на весь экран (Esc / клик — закрыть). pics: [{ url, thumb }] */
export function gallery(pics, onRemove, onMain) {
  const big = h('img', { class: 'g-big', src: PREFIX + (pics[0].medium || pics[0].url), alt: '', loading: 'lazy', decoding: 'async' });
  let cur = 0;
  // первое фото — главное (обложка в списках); ☆ на миниатюре ставит это фото первым — без лишнего шага
  const star = (p, i) => (onMain ? h('button', { type: 'button', class: 'pf-main' + (i ? '' : ' on'), title: i ? 'Сделать главным' : 'Главное фото', 'aria-label': i ? 'Сделать главным' : 'Главное фото', onclick: (e) => { e.stopPropagation(); if (i) onMain(p); } }, i ? '☆' : '★') : null);
  const show = (i) => { cur = i; big.src = PREFIX + (pics[i].medium || pics[i].url); strip.querySelectorAll('img').forEach((x, j) => x.classList.toggle('active', j === i)); };
  const strip = pics.length > 1 ? h('div', { class: 'g-strip' }, pics.map((p, i) => h('div', { class: 'g-th' }, h('img', { src: PREFIX + (p.thumb || p.url), alt: '', loading: 'lazy', decoding: 'async', class: i ? '' : 'active', onclick: () => show(i) }), star(p, i)))) : h('div');
  big.addEventListener('click', () => {
    const box = h('div', { class: 'lightbox', role: 'dialog', 'aria-label': 'Фото' }, h('img', { src: PREFIX + pics[cur].url, alt: '' }));
    const close = (e) => { if (!e || e.type === 'click' || e.key === 'Escape') { box.remove(); document.removeEventListener('keydown', close, true); e?.stopPropagation?.(); } };
    box.addEventListener('click', close);
    document.addEventListener('keydown', close, true);
    document.body.append(box);
  });
  const del = onRemove ? h('button', { class: 'btn btn-ghost btn-sm g-del', type: 'button', title: 'Убрать это фото из карточки', onclick: (e) => { e.stopPropagation(); onRemove(pics[cur]); } }, 'Убрать фото') : null;
  const mainHint = onMain && pics.length > 1 ? h('p', { class: 'hint' }, 'Первое фото — главное. Чтобы выбрать другое, нажмите ☆ на миниатюре.') : null;
  // «Убрать фото» уезжает к зоне загрузки (card() ставит её рядом с photoDrop); сама галерея кнопку не рисует
  const g = h('div', { class: 'gallery' }, big, strip, mainHint);
  g.delBtn = del;
  return g;
}
