/**
 * Одно уведомление — один вид везде (DESIGN §4 «Уведомление», 2026-10-25): всплывашка (toast.js),
 * строка истории в колокольчике (notices.js) и сбой в блоке (busy.js failBlock).
 * noticeCard({ tone, title, sub?, time?, actions?, onClose?, role?, cls? })
 *   tone: 'success' | 'error' | 'warn' | 'info' — значок и цвет полоски; actions: [{ label, run }].
 */
import { h } from '../core/dom.js';
import { icon } from './icons.js';

export const TONE_ICON = { success: 'ok', error: 'err', warn: 'warn', info: 'info' };
export const TONE_LABEL = { success: 'успех', error: 'ошибка', warn: 'внимание', info: 'сообщение' };

export function noticeCard({ tone = 'info', title, sub, time, actions, onClose, role, cls = '' } = {}) {
  const t = TONE_ICON[tone] ? tone : 'info';
  const acts = (actions || []).filter(Boolean);
  return h('div', { class: ('ntf ' + cls).trim(), 'data-tone': t, role: role || (t === 'error' ? 'alert' : 'status') },
    h('span', { class: 'ntf-ico' }, icon(TONE_ICON[t])),
    h('div', { class: 'ntf-body' },
      h('div', { class: 'ntf-title' }, title),
      sub ? h('div', { class: 'ntf-sub' }, sub) : null,
      time ? h('div', { class: 'ntf-time' }, time) : null),
    acts.length ? h('div', { class: 'ntf-acts' }, ...acts.map((a) => h('button', { type: 'button', class: 'ntf-btn', onclick: a.run }, a.label))) : null,
    onClose ? h('button', { type: 'button', class: 'ntf-x', 'aria-label': 'Убрать уведомление', title: 'Убрать', onclick: onClose }, '×') : null);
}

/** «сегодня 14:05» / «вчера 09:30» / «12 окт 18:00». */
export function noticeTime(at) {
  const d = new Date(at), now = new Date();
  const hm = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86400000);
  if (diff === 0) return 'сегодня ' + hm;
  if (diff === 1) return 'вчера ' + hm;
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }).replace('.', '') + ' ' + hm;
}

/** «Не удалось сохранить: причина» → заголовок и причина второй строкой. */
export function splitReason(text) {
  const m = /^(.{3,70}?): (.{3,})$/s.exec(String(text || ''));
  return m ? { title: m[1], sub: m[2] } : { title: String(text || '') };
}
