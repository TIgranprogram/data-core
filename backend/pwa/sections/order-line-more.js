/**
 * Подробности позиции заказа — раскрываются под её строкой в таблице «Позиции» (владелец 2026-11-15: вместо отдельной панели позиции).
 * Карточки: «Состав», «Выполнение», «Вложения», «Документы» (заготовки — C121). Деньги и правка позиции — в договоре.
 */
import { h } from '../core/dom.js';
import { date, qty } from '../core/format.js';
import { button, card } from '../ui/kit/index.js';
import { tileGrid } from '../ui/kit/blocks.js';
import { readonlyGroup } from '../ui/kit/readonly.js';
import { toastError } from '../ui/kit/toast.js';
import { markToday } from './orders.js';
import { patch } from '../core/router.js';

const box = (title, rows, acts) => card({ size: 'M', title, variant: 'fields', body: rows.length ? readonlyGroup({ rows }) : null, actions: acts.filter(Boolean) });

/** lineMore(l, o — договор, d — заказ, { reload, editable, closed }) → сетка карточек. */
export function lineMore(l, o, d, { reload, editable }) {
  const qtyN = Number(l.qty) || 0, shipped = Number(l.shipped) || 0;
  const ownDate = l.shipDate && d.deadline && String(l.shipDate).slice(0, 10) !== String(d.deadline).slice(0, 10);
  const done = (r) => { if (r) reload(); };
  const fail = (e) => toastError(e);
  // деньги и правка позиции — в договоре («⋯ → Договор»), здесь только сама позиция (владелец 15.11)
  const plan = (title, rows, hint) => card({ size: 'M', title, variant: 'fields', body: [rows.length ? readonlyGroup({ rows }) : null, h('p', { class: 'muted small' }, hint)].filter(Boolean) });
  const cards = [
    // заготовки C121 (владелец 15.11: «накидай куски, потом дорабатываем») — порядок: из чего состоит → выполнение → вложения → документы
    // «Состав» — из чего состоит изделие (модули, детали, работы), не само изделие (владелец 15.11)
    card({ size: 'M', title: 'Состав', variant: 'fields', body: h('p', { class: 'muted small' }, 'Будут модули, детали и работы изделия с отметками «сделано / не сделано».'),
      actions: l.productId ? [button({ label: 'Состав и работы изделия', size: 'S', kind: 'ghost', onClick: () => patch({ of: 'products', open: l.productId, new: undefined }, { replace: false }) })] : [] }),
    box('Выполнение', [
      ['Отгружено', `${qty(shipped)} из ${qty(qtyN)} ${l.unit || ''}`.trim()],
      ownDate ? ['Отгрузка', date(l.shipDate)] : null,
    ].filter(Boolean), [
      editable && shipped < qtyN && !l.shipDate && button({ label: 'Отгрузить сегодня', size: 'S', onClick: () => markToday(l, 'shipDate').then(done).catch(fail) }),
    ]),
    plan('Вложения', [], 'Будут папки с файлами позиции: перетащите файл на рабочий стол — скачается, обратно — загрузится.'),
    plan('Документы', [], 'Будут документы именно этой позиции: паспорт, акты.'),
  ].filter(Boolean);
  return tileGrid(...cards);
}
