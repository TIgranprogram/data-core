import { h } from '../core/dom.js';

/** Модальное окно. Возвращает Promise: значение из onOk или null при отмене. */
export function modal({ title, body, okText = 'OK', cancelText = 'Отмена', danger = false, wide = false, onOk }) {
  return new Promise((resolve) => {
    const err = h('div', { class: 'form-error', hidden: true });
    const ok = h('button', { class: 'btn ' + (danger ? 'btn-danger' : 'btn-primary'), type: 'submit' }, okText);
    const form = h('form', { class: 'modal' + (wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true' },
      h('div', { class: 'modal-head' }, h('h2', null, title)),
      h('div', { class: 'modal-body' }, err, body),
      h('div', { class: 'modal-foot' },
        h('button', { class: 'btn', type: 'button', onclick: () => done(null) }, cancelText), ok));
    const back = h('div', { class: 'modal-back', onmousedown: (e) => { if (e.target === back) done(null); } }, form);
    const onKey = (e) => { if (e.key === 'Escape') done(null); };
    function done(v) { document.removeEventListener('keydown', onKey, true); back.remove(); resolve(v); }
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      ok.disabled = true; err.hidden = true;
      try { done(onOk ? await onOk(form) : true); }
      catch (ex) { err.textContent = ex.message; err.hidden = false; ok.disabled = false; }
    });
    document.addEventListener('keydown', onKey, true);
    document.body.append(back);
    (form.querySelector('input, select, textarea') || ok).focus();
  });
}

/** Подтверждение: true/false. */
export async function confirmDlg(title, text, { okText = 'Да', danger = false } = {}) {
  return !!(await modal({ title, body: h('p', { style: { whiteSpace: 'pre-line' } }, text), okText, danger }));
}
