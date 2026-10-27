import { confirmPassword, session, setConfirmToken } from '../core/api.js';
import { h } from '../core/dom.js';
import { modal } from './dialog.js';

/**
 * Пароль перед удалением/восстановлением (ТИ-4, Т-А2): админу не нужен, остальным — свой пароль.
 * POST /auth/confirm {password} → {token}; токен уходит заголовком X-Confirm-Token (core/api.js) только на время fn.
 * Возвращает результат fn или null, если человек отказался вводить пароль.
 */
export async function withConfirm(fn, { text = 'Удаление защищено: введите пароль, которым вы входите в программу. Отдельный пароль задавать не нужно.' } = {}) {
  if (session.role === 'admin') return fn();
  const token = await modal({
    title: 'Введите пароль', okText: 'Подтвердить',
    body: h('div', null, h('p', { class: 'muted' }, text),
      h('label', null, 'Пароль для входа в программу', h('input', { type: 'password', name: 'password', autocomplete: 'current-password', required: true }))),
    onOk: async (form) => {
      const password = form.querySelector('input[name=password]').value;
      return confirmPassword(password);
    },
  });
  if (!token) return null;
  setConfirmToken(token);
  try { return await fn(); } finally { setConfirmToken(null); }
}
