import { api, session } from '../core/api.js';
import { h } from '../core/dom.js';
import { money, plural, qty } from '../core/format.js';
import { current, patch } from '../core/router.js';
import { errText } from './errors.js';
import { toast } from './toast.js';

/*
 * «Предложено из выдач» (SK-7b): состав изделия по тому, что выдали со склада под позицию заказа.
 * Правая панель ?of=compsug&new=1&lid=<id позиции заказа>: строки «было N, станет M», галочки, «Добавить в состав».
 * Ничего не удаляется, повторное «Добавить» количество не удваивает (сервер заменяет, а не прибавляет).
 * Цены показываются только если сервер их прислал (деньговые роли). Без права записи — просмотр без кнопки.
 */
const canAccept = () => ['admin', 'manager'].includes(session.user?.role) || session.user?.isOwner === true;

/** Открыть панель по позиции заказа (шагом: «назад» вернёт на карточку). */
export const openCompositionSuggest = (lineId) => patch({ of: 'compsug', new: '1', lid: lineId, open: undefined }, { replace: false });

/** Ссылка-кнопка «Предложено из выдач» для карточек изделия и заказа. */
export const suggestLink = (lineId, label = 'Предложено из выдач') => h('button', { type: 'button', class: 'btn btn-ghost btn-sm', title: 'Состав изделия по тому, что выдали со склада под эту позицию', onclick: (e) => { e.stopPropagation(); openCompositionSuggest(lineId); } }, label);

/** После выдачи под позицию заказа: если у позиции есть изделие и в составе есть что поменять — плашка-предложение. */
export async function offerAfterIssue(lineId) {
  if (!lineId) return;
  try {
    const s = await api('/stock/composition-suggest', { query: { salesOrderLineId: lineId } });
    if (!s.productId || !(s.items || []).some((x) => x.status !== 'same')) return;
    toast(`Добавить в состав изделия «${s.productName}»?`, { actions: [{ label: 'Посмотреть', run: () => openCompositionSuggest(lineId) }, { label: 'Не сейчас' }] });
  } catch { /* предложение необязательно: сбой не мешает выдаче */ }
}

const statusText = (x) => (x.status === 'add' ? `нет в составе → станет ${qty(x.perProduct)} ${x.unit}`
  : x.status === 'change' ? `было ${qty(x.current)} → станет ${qty(x.perProduct)} ${x.unit}`
    : `уже в составе: ${qty(x.current)} ${x.unit}`);

async function build() {
  const lid = current().params.lid;
  const stop = (text) => ({ el: h('p', { class: 'muted' }, text), dirty: () => false, focus: () => {}, readonly: true, read: () => ({ values: {} }) });
  let s;
  try { s = await api('/stock/composition-suggest', { query: { salesOrderLineId: lid } }); } catch (e) { return stop('Не удалось получить предложение: ' + errText(e)); }
  const items = s.items || [];
  if (!items.length) return stop(s.reason || 'Предложить пока нечего.');
  const write = canAccept();
  const chosen = new Set(items.filter((x) => x.status !== 'same').map((x) => x.materialId));
  const act = items.some((x) => x.status !== 'same');
  const rows = items.map((x) => {
    const cb = write && x.status !== 'same'
      ? h('input', { type: 'checkbox', checked: true, 'aria-label': 'Добавить в состав', onchange: () => { if (cb.checked) chosen.add(x.materialId); else chosen.delete(x.materialId); } })
      : h('span');
    return h('li', { class: 'spec-row' }, cb,
      h('div', { class: 'spec-main' }, h('div', { class: 'clip', title: x.name }, x.name),
        h('small', { class: x.status === 'same' ? 'muted' : '' }, statusText(x)),
        h('small', { class: 'muted' }, `выдано ${qty(x.issued)}${x.returned ? `, возвращено ${qty(x.returned)}` : ''} на ${qty(s.qty)} ${plural(s.qty, 'изделие', 'изделия', 'изделий')}${x.rounded ? ' · округлено' : ''}`)),
      h('span', { class: 'num nowrap' }, `${qty(x.perProduct)} ${x.unit}`),
      x.sum != null ? h('span', { class: 'num nowrap muted' }, money(x.sum)) : h('span'));
  });
  const el = h('div', null,
    h('p', { class: 'hint', title: 'На одно изделие = выдано под позицию (минус возвращённое) ÷ число изделий. «Добавить» заменяет количество в составе, ничего не удаляется.' }, `${s.position || ''} · «${s.productName}», в позиции ${qty(s.qty)} шт. — на одно изделие.`),
    h('ul', { class: 'spec-list' }, ...rows),
    s.total != null ? h('p', { class: 'spec-counts' }, h('b', null, `Материалы на одно изделие ≈ ${money(s.total)}`), s.missing ? h('span', { class: 'muted' }, ` · без цены: ${s.missing}`) : null) : null,
    !write ? h('p', { class: 'muted' }, 'Добавлять в состав могут администратор и менеджер.') : !act ? h('p', { class: 'muted' }, 'Всё уже в составе — менять нечего.') : null);

  async function save() {
    if (!chosen.size) throw new Error('Отметьте хотя бы одну строку');
    const r = await api('/stock/composition-suggest/accept', { method: 'POST', body: { salesOrderLineId: lid, materialIds: [...chosen] } });
    const n = (r.applied || []).length;
    toast(`Состав изделия «${s.productName}» обновлён: ${n} ${plural(n, 'позиция', 'позиции', 'позиций')}`);
    return r;
  }
  return { el, dirty: () => false, focus: () => {}, readonly: !write || !act, read: () => ({ values: { save } }) };
}

export const compSuggest = {
  id: 'compsug', title: 'Состав', newTitle: 'Предложено из выдач', card: { heading: () => 'Состав изделия' }, get: async () => ({}),
  canEdit: () => true, // смотреть могут все; кнопка «Добавить» — только тем, кому разрешает сервер
  form: { build, toBody: (v) => v, create: (v) => v.save(), saveLabel: 'Добавить в состав', closeAfterCreate: true },
};
