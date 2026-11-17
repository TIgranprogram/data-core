import { session } from '../core/api.js';
import { patch } from '../core/router.js';
import { button } from '../ui/kit/index.js';
import { toast, toastError } from '../ui/kit/toast.js';
import { canShip } from './order-shipments.js';
import { footerBar } from '../ui/kit/screens/blocks.js';
import { orderPassportsButton, orderZipButton, printOrderButton } from './order-passport-plan.js';
import { orderPdfAction, orderZipAction } from './order-attachments-zip.js';

/*
 * C124 «Подвал заказа» (владелец 15.11): всё, что делается со всем заказом или с отмеченными позициями.
 * Реестр действий — ACTIONS: новый документ или операция над набором позиций = одна строка здесь (без кнопок-пустышек).
 *   run(ctx) — ctx: { r — строка карточки, d — заказ целиком, lines — выбранные (или все живые) позиции, picked — отмечено ли, reload }
 *   show(ctx) — показывать ли (права, этап, есть ли что делать).
 */

const unshipped = (l) => !l.cancelledAt && (Number(l.shipped) || 0) < (Number(l.qty) || 0);

/** Договор ещё можно отгружать (не «Отгружен» / закрыт / отменён). C136: иначе POST даёт 400. */
const shipableOrder = (o) => o && !['shipped', 'closed', 'cancelled'].includes(o.stage);
const lineOrder = (d, lineId) => (d.orders || []).find((x) => (x.lines || []).some((l) => String(l.id) === String(lineId)));

/** Отгрузка — штатная панель «Отгрузка» договора (причина, получатель, документ); отмечены выбранные позиции. */
function shipLines(ctx) {
  const ids = new Set(ctx.lines.filter(unshipped).map((l) => String(l.id)));
  const o = (ctx.d.orders || []).find((x) => shipableOrder(x) && (x.lines || []).some((l) => ids.has(String(l.id))));
  if (!o) {
    const blocked = (ctx.d.orders || []).find((x) => x.stage === 'shipped' && (x.lines || []).some((l) => ids.has(String(l.id))));
    toast(blocked
      ? 'Заказ уже «Отгружен» — новая отгрузка недоступна. В «⋯» верните этап вручную, если нужна ещё одна.'
      : 'Отгружать нечего: всё уже отгружено');
    return;
  }
  const other = (ctx.d.orders || []).filter((x) => x !== o && shipableOrder(x) && (x.lines || []).some((l) => ids.has(String(l.id))));
  if (other.length) toast('Отгрузка записывается по договору: открыт первый, остальные — после него', { ms: 6000 });
  patch({ of: 'shipdo', open: o.id, new: undefined, pick: (o.lines || []).filter((l) => ids.has(String(l.id))).map((l) => l.id).join(',') }, { replace: false });
}

/** Группы подвала. Порядок групп и действий — порядок на экране. */
const ACTIONS = [
  { group: 'Документы', items: (ctx) => {
    const orders = (ctx.d.orders || []).filter((o) => (o.lines || []).length);
    const many = orders.length > 1;
    if (!session.seesDocs()) return [];
    const only = () => (ctx.picked ? new Set(ctx.lines.map((l) => String(l.id))) : null);
    return orders.flatMap((o) => {
      const pass = orderPassportsButton(o.id);
      if (many) pass.textContent = `Паспорта · договор ${o.orderNo || '—'}`;
      return [pass, printOrderButton(o.id, { issued: 1, only, kind: 'ghost', size: 'S' }), orderZipButton(o.id, { issued: 1 })];
    });
  } },
  { group: 'Работа', items: (ctx) => {
    // C136: не показывать «Отгрузить», если все подходящие договоры уже «Отгружен»
    const ready = ctx.lines.filter((l) => unshipped(l) && shipableOrder(lineOrder(ctx.d, l.id)));
    return canShip() && ready.length
      ? [button({ label: ctx.picked ? `Отгрузить отмеченные (${ready.length})` : 'Отгрузить…', size: 'S', onClick: () => shipLines(ctx) })]
      : [];
  } },
  { group: 'Файлы', items: (ctx) => [
    button({ label: orderPdfAction.label, title: orderPdfAction.title, size: 'S', kind: 'ghost', onClick: () => Promise.resolve(orderPdfAction.run(ctx.r)).catch(toastError) }),
    button({ label: 'Вложения (ZIP)', title: orderZipAction.title, size: 'S', kind: 'ghost', onClick: () => Promise.resolve(orderZipAction.run(ctx.r)).catch(toastError) }),
  ] },
];

/**
 * orderFooter(r, d, sel, { reload }) → { el, update() }. sel — Map(id → позиция) из галочек таблицы позиций.
 * Нет отметок — действия для всего заказа.
 */
export function orderFooter(r, d, sel, { reload, onClear } = {}) {
  const live = (d.orders || []).flatMap((o) => o.lines || []).filter((l) => !l.cancelledAt);
  const ctx = () => ({ r, d, reload, picked: sel.size > 0, lines: sel.size ? [...sel.values()] : live });
  const fb = footerBar({
    total: live.length,
    groups: ACTIONS.map((a) => ({ label: a.group, items: () => a.items(ctx()) })),
    onClear,
  });
  return { el: fb.el, update: () => fb.update(sel.size) };
}
