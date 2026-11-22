import { api, session } from '../core/api.js';
import { h } from '../core/dom.js';
import { canFollow } from '../core/route-access.js';
import { current } from '../core/router.js';
import { badge, hint, section, sku, stack } from '../ui/kit/index.js';
import { viewAsActive } from '../core/view-as.js';
import { screenCard } from '../ui/kit/screens/card.js';
import { positionsTable } from '../ui/kit/screens/blocks.js';
import { askAssignee, clean } from './design-data.js';

const steps = {
  queue: ['work', 'Начать проектирование'],
  work: ['done', 'Завершить проектирование'],
  paused: ['work', 'Возобновить проектирование'],
};

function orderRef(row) {
  const key = row.productionNo || row.orderId;
  if (!key) return '';
  const position = row.seqNo ?? row.lineNo;
  const label = [row.productionNo ? 'Заказ № ' + row.productionNo : 'Договор ' + (row.orderNo || 'без номера'),
    position == null ? '' : 'поз. ' + position].filter(Boolean).join(' · ');
  const href = '#salesorders?open=' + encodeURIComponent(key);
  return canFollow(session, href) ? h('a', { class: 'ref-orders', href }, label) : label;
}

function requirements(row) {
  const { size, mount, cover, ral, extra } = row.spec || {};
  return [['Габариты', size], ['Крепление', mount], ['Покрытие', cover], ['RAL', ral], ['Дополнительно', extra]]
    .flatMap(([label, value]) => clean(value) ? [{ cells: [label, clean(value)] }] : []);
}

function brief(row, title) {
  const name = clean(row.customerTitle) || title(row);
  const amount = row.qty ?? row.spec?.qty;
  const unit = clean(row.unit || row.spec?.unit) || 'шт';
  const linked = row.productId && row.sku ? '#products?open=' + encodeURIComponent(row.productId) : '';
  const article = sku(clean(row.sku));
  const spec = requirements(row);
  const raw = clean(row.spec?.raw);
  const note = clean(row.note);
  const details = raw || note ? () => stack(
    raw ? section({ title: 'Исходный текст позиции', open: true, body: h('div', { class: 'u-pre' }, raw) }) : null,
    note ? section({ title: 'Примечание к задаче', open: true, body: h('div', { class: 'u-pre' }, note) }) : null,
  ) : undefined;
  return positionsTable({
    label: 'Задание на проектирование',
    columns: [{ label: 'Параметр', wrap: true }, { label: 'Задание', wrap: true }],
    groups: [{ rows: [
      { expand: details, cells: ['Позиция', h('div', null, h('strong', null, name), clean(row.sku) ? h('div', { class: 'muted small' },
        linked && canFollow(session, linked) ? h('a', { href: linked }, article) : article) : null,
      details ? h('div', { class: 'muted small' }, raw ? 'Исходный текст' : 'Примечание к задаче') : null)] },
      { cells: ['Изготовить', amount ? h('b', { class: 'num' }, amount + ' ' + unit) : h('span', { class: 'muted' }, 'Не указано')] },
      { cells: ['Исполнитель', row.assignee?.name || h('span', { class: 'muted' }, 'Не назначен')] },
      ...spec,
    ] }],
  });
}

function productionText(row) {
  switch (row.production?.state) {
    case 'no-position': return 'У заказа нет действующей позиции для запуска.';
    case 'contract-closed': return 'Договор в архиве. Запуск недоступен.';
    case 'no-product': return 'Для запуска сопоставьте позицию заказа с изделием.';
    case 'in-work': return 'Изготовление уже запущено' + (row.production.workCode ? ' · ' + row.production.workCode : '') + '.';
    case 'ready-for-review': return 'В заказе можно проверить состав и маршрут перед запуском.';
    case 'standalone': return 'Задача без заказа.';
    default: return row.orderId ? 'Проверка и запуск изготовления доступны в заказе.' : 'Задача без заказа.';
  }
}

function lazyBlock(title, open, make, count, tone = 'neutral') {
  const content = stack();
  const block = section({ title, count, tone, open, body: content });
  function load() { block.removeEventListener('toggle', opened); make(content); }
  function opened() { if (block.open) load(); }
  if (open) load(); else block.addEventListener('toggle', opened);
  return block;
}

function relatedBlocks(row, ctx, { discussionBlock: discussion, photosBlock, stickersBlock, visibleStickers }) {
  const tab = current().params.tab;
  const talk = discussion(row, ctx, { open: tab === 'talk' });
  const media = lazyBlock('Фото и стикеры', tab !== 'talk', (body) => {
    const can = session.canEdit && !viewAsActive();
    body.append(photosBlock(row, ctx, can));
    visibleStickers().then((list) => {
      const stickers = stickersBlock(row, list.filter((item) => item.kind !== 'system'), ctx, can);
      if (stickers) body.append(stickers);
    });
  });
  return [media, talk];
}

export function designTaskCard({ title, dueNode, prioBadge, status, moveTask, people, blocks, composition }) {
  const move = (to, label) => ({ label, run: async (row, ctx) => {
    const saved = await moveTask(row, to);
    if (saved) ctx.setRow(saved);
  } });
  const view = screenCard({
    title: (row) => row.code + ' · ' + title(row),
    sub: orderRef,
    side: (row) => [dueNode(row), h('span', { class: 'actions' }, badge(status, row.status), prioBadge(row))],
    facts: () => [],
    bodyFirst: true,
    next: (row, ctx) => {
      const step = row.status === 'paused' && !row.assigneeId ? ['queue', 'Вернуть на распределение'] : steps[row.status];
      return { text: productionText(row), primary: step && session.canEdit ? { label: step[1], run: () => move(...step).run(row, ctx) } : null };
    },
    body: (row, ctx, next) => stack(brief(row, title), ...next, composition?.(row),
      (row.status === 'paused' || row.status === 'cancelled') && clean(row.pauseReason) ? hint(row.pauseReason, 'warn') : null,
      ...relatedBlocks(row, ctx, blocks)),
    menu: (row) => [
      { label: 'Изменить задачу', run: (_row, ctx) => ctx.edit() },
      { label: 'Назначить исполнителя…', run: async (currentRow, ctx) => {
        const id = await askAssignee(await people(), { okText: 'Назначить' });
        if (id) ctx.setRow(await api('/design-tasks/' + currentRow.id, { method: 'PATCH', body: { assigneeId: id } }));
      } },
      ['queue', 'work'].includes(row.status) && move('paused', 'Приостановить'),
      row.status === 'paused' && move('done', 'Завершить проектирование'),
      (row.status === 'work' || row.status === 'cancelled' || row.status === 'paused' && row.assigneeId) && move('queue', 'Вернуть на распределение'),
      row.status === 'done' && move('work', 'Вернуть в проектирование'),
      ['queue', 'work', 'paused'].includes(row.status) && { ...move('cancelled', 'Отменить задачу'), danger: true },
    ],
  });
  return { ...view, editable: () => false, historyItems: async (row, items) => [
    ...items.filter((item) => item.action !== 'designnote.created'), ...await blocks.designPhotoHistory(row).catch(() => []),
  ].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)) };
}
