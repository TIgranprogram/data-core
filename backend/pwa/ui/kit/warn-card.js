/**
 * Карточка предупреждения (warnCard) — «проблема и её исправление» (DESIGN §3.2). Бывший noticeCard (ui/notice-card.js, там остался реэкспорт).
 * Один вид везде: всплывашка (toast.js), строка истории в колокольчике (notices.js), сбой в блоке (busy.js failBlock), предупреждение над сведениями карточки.
 * warnCard({ tone, title, sub?, time?, actions?, onClose?, role?, cls? })
 *   tone: 'success' | 'error' | 'warn' | 'info' — значок и цвет полоски; actions: [{ label, run }] — кнопка «исправить».
 */
import { h } from '../../core/dom.js';
import { icon } from '../icons.js';
import { mark } from './mark.js';

const TONE_ICON = { success: 'ok', error: 'err', warn: 'warn', info: 'info' };

export function warnCard({ tone = 'info', title, sub, time, actions, onClose, role, cls = '' } = {}) {
  const t = TONE_ICON[tone] ? tone : 'info';
  const acts = (actions || []).filter(Boolean);
  return mark(h('div', { class: ('ntf ' + cls).trim(), 'data-tone': t, role: role || (t === 'error' ? 'alert' : 'status') },
    h('span', { class: 'ntf-ico' }, icon(TONE_ICON[t])),
    h('div', { class: 'ntf-body' },
      h('div', { class: 'ntf-title' }, title),
      sub ? h('div', { class: 'ntf-sub' }, sub) : null,
      time ? h('div', { class: 'ntf-time' }, time) : null),
    acts.length ? h('div', { class: 'ntf-acts' }, ...acts.map((a) => h('button', { type: 'button', class: 'btn btn-sm', onclick: a.run }, a.label))) : null,
    onClose ? h('button', { type: 'button', class: 'ntf-x', 'aria-label': 'Убрать уведомление', title: 'Убрать', onclick: onClose }, '×') : null), 'warnCard');
}
