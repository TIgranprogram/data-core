import { h } from '../core/dom.js';

/**
 * Хлебные крошки (DESIGN §4): Группа › Раздел › (хвост) — одна полоса над экраном, рисует main.js.
 * Группа — подпись без ссылки (своей страницы нет); раздел — ссылка, пока есть хвост; последнее звено — текущее.
 * Хвост (имя поставщика и т.п.) раздел сообщает сам: setCrumbTail('Название').
 */
const el = h('nav', { class: 'crumbs', 'aria-label': 'Где вы', hidden: true });
let state = { group: '', title: '', href: '' };
let tail = null;

function paint() {
  const parts = [];
  if (state.group) parts.push(h('span', { class: 'crumb-group' }, state.group));
  if (state.title) parts.push(tail ? h('a', { class: 'crumb', href: state.href }, state.title) : h('span', { class: 'crumb cur', 'aria-current': 'page' }, state.title));
  if (tail) parts.push(h('span', { class: 'crumb cur', 'aria-current': 'page' }, tail));
  const out = [];
  parts.forEach((p, i) => { if (i) out.push(h('span', { class: 'crumb-sep', 'aria-hidden': 'true' }, '›')); out.push(p); });
  el.replaceChildren(...out);
  el.hidden = !state.group;
}

/** Показать крошки раздела; group пустая — полосы нет (у раздела нет группы). */
export function setCrumbs(next) { state = next; tail = null; paint(); }
export function setCrumbTail(text) { tail = text || null; paint(); }
export const crumbsEl = el;
