import { api, session } from '../core/api.js';
import { h } from '../core/dom.js';
import { modal } from '../ui/kit/index.js';

/**
 * ЗЯ-1c: администратор обходит запрет с причиной.
 * adminAction — два шага: ?dryRun=1 (что изменится) → «подтвердить» с причиной.
 * withReason — обычный запрос; если сервер просит причину (администратор снимает запрет), спрашиваем и повторяем.
 */
const MIN = 3;
export const isAdmin = () => !!(session.isAdmin || session.role === 'admin' || session.user?.isOwner);

function reasonBox() {
  const input = h('textarea', { name: 'reason', rows: 3, maxlength: 500, placeholder: 'Например: ошибка при вводе', 'aria-label': 'Причина' });
  return { input, el: h('label', { class: 'field wide' }, h('span', null, 'Причина (обязательно)'), input) };
}
const needText = (input) => {
  const v = input.value.trim();
  if (v.length < MIN) { input.focus(); throw new Error('Напишите причину — не меньше 3 букв'); }
  return v;
};
const list = (items, cls) => items?.length ? h('ul', { class: cls }, ...items.map((t) => h('li', null, t))) : null;

/** Только причина → строка или null (отмена). */
export function askReason(title, text, okText = 'Сохранить') {
  const box = reasonBox();
  return modal({ title, okText, body: h('div', null, text ? h('p', null, text) : null, box.el), onOk: () => needText(box.input) });
}

/** POST path?dryRun=1 → окно с последствиями → POST {confirm:true, reason}. Результат сервера или null (отмена / нельзя). */
export async function adminAction(path, { title, okText = 'Подтвердить', lead = '' }) {
  const plan = await api(`${path}?dryRun=1`, { method: 'POST', body: {} });
  if (plan && plan.canProceed === false) {
    await modal({ title, okText: 'Понятно', cancelText: 'Закрыть', body: h('div', null,
      h('p', null, h('b', null, 'Сейчас это сделать нельзя:')), list(plan.blockers), list(plan.warnings)) });
    return null;
  }
  const box = reasonBox();
  return modal({ title, okText, danger: true,
    body: h('div', null, lead ? h('p', null, lead) : null,
      list(plan?.warnings, 'hint'), plan?.relatedAction ? h('p', { class: 'hint' }, plan.relatedAction) : null, box.el),
    onOk: () => api(path, { method: 'POST', body: { confirm: true, reason: needText(box.input) } }) });
}

/** run(reason?) → результат; null — администратор отказался от причины. Сервер просит причину (code REASON_REQUIRED) → спросить и повторить. */
export async function withReason(run, title = 'Изменение без обычных ограничений') {
  try { return await run(undefined); }
  catch (e) {
    if (!(isAdmin() && e?.data?.code === 'REASON_REQUIRED')) throw e;
    const reason = await askReason(title, 'Это действие обычно закрыто. Администратор может его сделать — запишем кто, что и почему.');
    if (!reason) return null; // отмена — тихо
    return run(reason);
  }
}
