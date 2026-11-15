/**
 * Подробности позиции заказа — раскрываются под её строкой в таблице «Позиции» (владелец 2026-11-15: вместо отдельной панели позиции).
 * Карточки: «Состав», «Выполнение», «Вложения», «Документы» (заготовки — C121). Деньги и правка позиции — в договоре.
 */
import { h } from '../core/dom.js';
import { date, qty } from '../core/format.js';
import { api } from '../core/api.js';
import { button, card, badge, empty, stack, actions, busyBlock, failBlock } from '../ui/kit/index.js';
import { numberOf, statusOf } from './passports/common.js';
import { printDialog } from './passports/dialogs.js';
import { tileGrid } from '../ui/kit/blocks.js';
import { readonlyGroup } from '../ui/kit/readonly.js';
import { toastError } from '../ui/kit/toast.js';
import { markToday } from './orders.js';
import { patch, go } from '../core/router.js';
import { lineFilesCard } from './order-line-files.js';

const box = (title, rows, acts) => card({ size: 'M', title, variant: 'fields', body: rows.length ? readonlyGroup({ rows }) : null, actions: acts.filter(Boolean) });

/** «Состав»: до 6 строк из GET /showcase/:id (composition), только чтение; «Весь состав» — изделие. */
function compositionCard(l) {
  const body = h('div');
  const open = () => patch({ of: 'products', open: l.productId, new: undefined }, { replace: false });
  const load = async () => {
    body.replaceChildren(busyBlock('состав', { retry: load }));
    try {
      const p = await api(`/showcase/${l.productId}`);
      const lines = p.composition || [];
      if (!lines.length) { body.replaceChildren(empty({ title: 'Состав не заполнен', hint: 'Модули и детали добавляют в карточке изделия.' })); return; }
      const rows = lines.slice(0, 6).map((x) => [x.name || 'Без названия', `${qty(x.quantity)} ${x.unit || 'шт'}`]);
      body.replaceChildren(readonlyGroup({ rows }), lines.length > 6 ? h('p', { class: 'muted small' }, `и ещё ${lines.length - 6}`) : null);
    } catch (e) { body.replaceChildren(failBlock(e, load, { text: 'Состав не загрузился' })); }
  };
  if (l.productId) load(); else body.replaceChildren(h('p', { class: 'muted small' }, 'У позиции нет изделия.'));
  return card({ size: 'M', title: 'Состав', variant: 'fields', body, actions: l.productId ? [button({ label: 'Весь состав', size: 'S', kind: 'ghost', onClick: open })] : [] });
}

/** «Документы»: паспорт позиции — GET /passports?salesOrderId, отбор по incomeId; номер, статус, открыть, PDF (printDialog). */
function documentsCard(l, d) {
  const body = h('div');
  const load = async () => {
    body.replaceChildren(busyBlock('документы', { retry: load }));
    try {
      if (!(l.orderId || d.orderId)) { body.replaceChildren(empty({ title: 'Паспорта ещё нет', hint: 'Позиция не привязана к заказу.' })); return; }
      const r = await api('/passports', { query: { salesOrderId: l.orderId || d.orderId, limit: 200 } });
      const p = (r.items || []).find((x) => String(x.incomeId) === String(l.id));
      if (!p) { body.replaceChildren(empty({ title: 'Паспорта ещё нет', hint: 'Выпускается в «Документы → Паспорта заказа».' })); return; }
      const issued = statusOf(p) === 'issued';
      body.replaceChildren(stack(actions(
        button({ label: numberOf(p) ? `Паспорт № ${numberOf(p)}` : 'Паспорт — черновик', size: 'S', kind: 'ghost', onClick: () => go('docs', { tab: 'orders', of: 'passports', open: p.id }, { kind: 'card' }) }),
        badge(issued ? 'выпущен' : 'черновик', issued ? 'ok' : 'warn')),
      issued ? button({ label: 'Скачать PDF', size: 'S', kind: 'ghost', onClick: (e) => { const b = e.currentTarget; b.classList.add('is-busy'); printDialog(p).catch(toastError).finally(() => b.classList.remove('is-busy')); } }) : null));
    } catch (e) { body.replaceChildren(failBlock(e, load, { text: 'Документы не загрузились' })); }
  };
  load();
  return card({ size: 'M', title: 'Документы', variant: 'fields', body });
}

/** lineMore(l, o — договор, d — заказ, { reload, editable, closed }) → сетка карточек. */
export function lineMore(l, o, d, { reload, editable }) {
  const qtyN = Number(l.qty) || 0, shipped = Number(l.shipped) || 0;
  const ownDate = l.shipDate && d.deadline && String(l.shipDate).slice(0, 10) !== String(d.deadline).slice(0, 10);
  const done = (r) => { if (r) reload(); };
  const fail = (e) => toastError(e);
  // деньги и правка позиции — в договоре («⋯ → Договор»), здесь только сама позиция (владелец 15.11)
  const cards = [
    // заготовки C121 (владелец 15.11: «накидай куски, потом дорабатываем») — порядок: из чего состоит → выполнение → вложения → документы
    compositionCard(l),
    box('Выполнение', [
      ['Отгружено', `${qty(shipped)} из ${qty(qtyN)} ${l.unit || ''}`.trim()],
      ownDate ? ['Отгрузка', date(l.shipDate)] : null,
    ].filter(Boolean), [
      editable && shipped < qtyN && !l.shipDate && button({ label: 'Отгрузить сегодня', size: 'S', onClick: () => markToday(l, 'shipDate').then(done).catch(fail) }),
    ]),
    lineFilesCard(l),
    documentsCard(l, d),
  ].filter(Boolean);
  return tileGrid(...cards);
}
