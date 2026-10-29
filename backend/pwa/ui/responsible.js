import { api } from '../core/api.js';
import { h } from '../core/dom.js';
import { dateTime } from '../core/format.js';

/**
 * «Ответственный» у заявки и заказа (ЗО-5): список сотрудников для выбора и строка «Передано: А → Б».
 * Сервер: GET /staff (только админ/директор — у остальных поле просто не показывается), GET /handoffs/:entity/:id.
 */
let cache = null;
export async function staffOptions() {
  cache ??= api('/staff').then((r) => (r.items || []).map((p) => ({ value: p.id, label: p.name + (p.position ? ' · ' + p.position : '') }))).catch((e) => { cache = null; throw e; });
  return cache;
}

/** Поле формы «Ответственный» (select); сотрудников нет или список закрыт ролью — поля нет. */
export async function responsibleField(hint) {
  const opts = await staffOptions().catch(() => null);
  return opts && opts.length ? { key: 'responsibleId', label: 'Ответственный', type: 'select', options: opts, hint: hint || 'Кому передана заявка. Смена записывается в историю передач.' } : null;
}

/** Строка «Передано: А → Б · дата · кто» по последней передаче; передач нет — пусто. entity: supplyrequest | salesorder. */
export function handoffLine(entity, id) {
  const el = h('div', { class: 'ho-line hint', hidden: true });
  api(`/handoffs/${entity}/${id}`).then((r) => {
    const x = (r.items || [])[0]; if (!x) return;
    el.hidden = false;
    el.replaceChildren('Передано: ', h('b', null, x.from || 'не было ответственного'), ' → ', h('b', null, x.to || 'снят'), ' · ' + dateTime(x.at) + (x.by ? ' · ' + x.by : ''));
  }).catch(() => {});
  return el;
}
