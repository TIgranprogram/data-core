import { h } from '../core/dom.js';
import { api, session } from '../core/api.js';
import { qty } from '../core/format.js';
import { row as kitRow, section, stack, sku as kitSku, table, posPic } from '../ui/kit/index.js';
import { orderPassportActions } from './order-passports.js';

/** Тексты и блоки карточки заказа (вынесено из salesorders.js, C118 W2: файл не растёт): подсказки этапов, «Выдано со склада», «Паспорта», «К производству». */
/** Подсказка у кнопки следующего этапа: что произойдёт и что дальше. */
export const NEXT_TIP = {
  new: 'Заказ уйдёт в производство. Дальше — «Готово к отгрузке», когда всё изготовлено.',
  production: 'Отметьте, когда всё изготовлено. Дальше оформите отгрузку — этап «Частично отгружен» / «Отгружен» поставится сам.',
  ready: 'Обычно этап ставится сам, когда оформлена отгрузка. Кнопка — если отгрузили без документа.',
  shipped: 'Завершить заказ, когда работа и оплата закончены. Завершённый заказ уходит во вкладку «Завершённые».',
};
/** Откуда этап и что дальше — строка в карточке заказа. */
export const STAGE_NOW = {
  new: 'Сейчас — проектирование (после распределения позиций). Дальше — «В производство».',
  production: 'Сейчас — производство. Когда всё изготовлено — кнопка «Отметить: готов к отгрузке» в блоке «Готовность».',
  ready: 'Готов к отгрузке. Этап «Частично отгружен» / «Отгружен» поставится сам, когда оформите отгрузку.',
  partly: 'Отгружено частично. Когда отгрузите всё — этап «Отгружен» поставится сам.',
  shipped: 'Отгружено всё. Завершите заказ, когда работа и оплата закончены.',
  closed: 'Заказ завершён. Вернуть его в работу может только администратор.',
};
export const HINT = {
  new: 'Новые: сначала распределите позиции — заказ сам попадёт в «Проектирование». Дальше — производство или отгрузка.',
  active: 'Заказы в работе: проектирование, производство, готовые к отгрузке. Красный срок — просрочено.',
  shipped: 'Отгруженные: всё отгружено, но заказ ещё не завершён. Когда работа и оплата закончены — «Завершить заказ». По месяцам.',
  closed: 'Завершённые заказы — по месяцам. Нажмите на месяц, чтобы раскрыть. Вернуть заказ в работу может администратор.',
};

/** Строка «Наше: …» под названием позиции; у сопоставленного — артикул эталоном kit.sku. */
export const ourLine = (l) => {
  if (l.product?.name || l.product?.sku) {
    return h('div', { class: 'muted small' }, 'Наше: ', kitSku(l.product.sku), l.product.sku ? ' ' : null, l.product.name || '');
  }
  const our = l.productName && [l.sku || l.productSku, l.productName].filter(Boolean).join(' · ');
  if (our) return h('div', { class: 'muted small' }, 'Наше: ' + our);
  return l.productId || l.product ? null : h('div', { class: 'muted small' }, 'Свяжите с каталогом');
};

/** «Выдано со склада» по позициям заказа (SK-5b): нетто = выдано − возвращено; позиция — «552-2 · название». */
export function issuedBlock(d, suggestLink) {
  const by = d.issuedByLine || [];
  if (!by.length) return '';
  const lines = d.lines || [];
  const groups = new Map();
  for (const x of by) { const k = x.salesOrderLineId ? String(x.salesOrderLineId) : ''; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(x); }
  const title = (k) => { if (!k) return 'Весь заказ (без позиции)'; const i = lines.findIndex((l) => String(l.id) === k); return i < 0 ? 'Позиция заказа' : `поз. ${lines[i].seqNo ?? lines[i].lineNo ?? i + 1} · ${lines[i].title}`; };
  return sec('Выдано со склада по позициям', 'gold', groups.size, stack(...[...groups].flatMap(([k, xs]) => xs.map((x, i) => kitRow({
    lead: i === 0 ? posPic(x.photo, 'sm') : null,
    title: i === 0 ? h('span', { title: title(k) }, title(k)) : (x.materialName || 'позиция'),
    meta: i === 0 ? (x.materialName || 'позиция') : null,
    side: [h('span', { class: 'num neg', title: 'Выдано минус возвращено' }, qty(x.net) + ' ' + (x.unit || ''))],
    below: [`выдано ${qty(x.issued)}${x.returned ? ', возвращено ' + qty(x.returned) : ''}`,
      i === 0 && k && lines.find((l) => String(l.id) === k)?.productId ? suggestLink(k) : null].filter(Boolean)})))));
}

/** Строка «Паспорта N (готовы M)» → вкладка «По заказам» (ТИ-11). */
export function orderPassports(r) {
  if (!session.seesDocs()) return null;
  const val = h('span', { class: 'muted' }, 'загрузка…');
  const body = h('div', null, val); const box = stack(section({ title: 'Паспорта', tone: 'neutral', open: true, body }));
  let actEl = null; // кнопка-действие под строкой (замена классу-маркеру op-act)
  const load = () => api('/passports', { query: { salesOrderId: r.id, limit: 200 } }).then((d) => {
    const items = (d.items || []).filter((p) => p.status !== 'annulled');
    actEl?.remove();
    actEl = orderPassportActions(r, items, load);
    if (actEl) body.append(actEl);
    const ready = items.filter((p) => (p.readiness || (p.status === 'draft' ? 'notReady' : 'ready')) === 'ready').length;
    val.replaceChildren(items.length ? h('a', { href: '#docs?tab=orders&open=' + r.id }, `Паспорта ${items.length} (готовы ${ready})`) : 'Паспортов пока нет');
  }).catch((e) => val.replaceChildren(e?.status === 403 ? 'Нет доступа к паспортам' : 'не удалось загрузить'));
  load();
  return box;
}

export const sec = (title, tone, count, ...kids) => section({ title, tone, count, open: tone === 'money' || undefined, body: kids });
export const seq = (l, i) => l.seqNo ?? l.lineNo ?? i + 1;
/** «К производству»: одинаковые позиции всех договоров заказа сложены вместе (только просмотр). */
export function produceBlock(d, openLine) {
  const t = d.toProduce || [];
  const lineBySeq = new Map();
  (d.orders || []).forEach((o) => (o.lines || []).forEach((l, i) => lineBySeq.set(String(seq(l, i)), l)));
  const openOf = (x) => { const l = (x.seqNos || []).map((n) => lineBySeq.get(String(n))).find(Boolean); return l && openLine ? openLine(l) : undefined; };
  if (!t.length) return null;
  // ничего не сложилось (строк столько же, сколько позиций) — это дубль таблицы «Позиции», не показываем (владелец 15.11)
  const live = (d.orders || []).flatMap((o) => o.lines || []).filter((l) => !l.cancelledAt).length;
  if (t.length >= live) return null;
  const nameCell = (x) => (x.sku
    ? h('span', { title: [x.sku, x.title].filter(Boolean).join(' · ') }, kitSku(x.sku), ' ', x.title)
    : x.title);
  return sec('К производству', 'main', t.length,
    table({ clickable: true, columns: [{ label: '№' }, { label: '' }, { label: 'Изделие' }, { label: 'Кол-во', num: true }, { label: 'Ед. изм.' }, { label: 'Из позиций' }],
      rows: t.map((x, i) => ({ onClick: openOf(x), cells: [{ v: i + 1, cls: 'muted' }, { v: posPic(x.photo, x.photo?.url || x.photo?.thumb ? 'lg' : 'sm'), cls: 'pic-cell' }, nameCell(x), qty(x.qty), { v: x.unit || '', cls: 'muted' }, { v: (x.seqNos || []).join(', '), cls: 'muted' }] })) }),
    h('p', { class: 'hint' }, 'Одинаковые позиции всех договоров заказа сложены вместе — чтобы запустить в работу сразу всё. Нажмите строку — откроется позиция.'));
}

