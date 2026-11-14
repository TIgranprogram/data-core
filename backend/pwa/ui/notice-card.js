/**
 * Одно уведомление — один вид везде (DESIGN §4 «Уведомление», 2026-10-25): всплывашка (toast.js),
 * строка истории в колокольчике (notices.js) и сбой в блоке (busy.js failBlock).
 * noticeCard({ tone, title, sub?, time?, actions?, onClose?, role?, cls? })
 *   tone: 'success' | 'error' | 'warn' | 'info' — значок и цвет полоски; actions: [{ label, run }].
 */
import { warnCard } from './kit/warn-card.js';

export const TONE_LABEL = { success: 'успех', error: 'ошибка', warn: 'внимание', info: 'сообщение' };
/** Прежнее имя: карточка предупреждения теперь kit.warnCard (DESIGN §3.2); старые вызовы работают. */
export const noticeCard = warnCard;

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
