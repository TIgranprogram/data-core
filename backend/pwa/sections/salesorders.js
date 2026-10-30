import { api, PREFIX, session, writeHooks } from '../core/api.js';
import { ordersLookup } from '../core/orders-lookup.js';
import { h } from '../core/dom.js';
import { date, isoDay, money, parseNum, qty } from '../core/format.js';
import { go, patch } from '../core/router.js';
import { badge, ORDER_PRIORITY } from '../ui/badges.js';
import { toast } from '../ui/toast.js';
import { confirmDlg, modal } from '../ui/dialog.js';
import { withConfirm } from '../ui/confirm-password.js';
import { incomeLookups } from './orders.js';
import { customerLink } from '../ui/links.js';
import { responsibleField, handoffLine } from '../ui/responsible.js';
import { errText } from '../ui/errors.js';
import { failBlock } from '../ui/busy.js';
import { orderReservations } from './order-reservations.js';
import { suggestLink } from '../ui/composition-suggest.js';
import { orderDesign } from './order-design.js';
import { orderWork } from './order-work.js';
import { unassignedTop, addContractsDialog } from './salesorders-unassigned.js';
import { unmatchedTop, unmatchedPlate, unmatchedFlag, unmatchedOrders } from './matching-queue.js';
import { shipmentsBlock, historyBlock, canShip } from './order-shipments.js';

/**
 * Раздел «Заказы» (TASKS фаза З): заказ = шапка (`salesorders`) + позиции (строки `incomes`).
 * Вкладки «В работе / Закрытые», доска по этапам, карточка: позиции, что заказано под заказ
 * (заявки) и что отпущено со склада. Закрытые сворачиваются по месяцам отгрузки (фаза М).
 */
export const STAGE = {
  new: { label: 'Проектирование', tone: 'primary' },
  production: { label: 'Производство', tone: 'info' },
  ready: { label: 'Готово к отгрузке', tone: 'warn' },
  partly: { label: 'Частично отгружен', tone: 'warn' },
  shipped: { label: 'Отгружен', tone: 'ok' },
  closed: { label: 'Закрыт', tone: 'dim' },
  cancelled: { label: 'Отменён', tone: 'danger' },
};
const NEXT = { new: 'production', production: 'ready', ready: 'shipped', shipped: 'closed' };
const NEXT_LABEL = { new: 'В производство', production: 'Готово к отгрузке', ready: 'Отгружен', shipped: 'Закрыть' };
const STAGE_ORDER = Object.keys(STAGE);
/** Подсказка у кнопки следующего этапа: что произойдёт и что дальше. */
const NEXT_TIP = {
  new: 'Заказ уйдёт в производство. Дальше — «Готово к отгрузке», когда всё изготовлено.',
  production: 'Отметьте, когда всё изготовлено. Дальше оформите отгрузку — этап «Частично отгружен» / «Отгружен» поставится сам.',
  ready: 'Обычно этап ставится сам, когда оформлена отгрузка. Кнопка — если отгрузили без документа.',
  shipped: 'Закрыть заказ, когда работа и оплата завершены. Закрытый заказ уходит в «Закрытые».',
};
/** Откуда этап и что дальше — строка в карточке заказа. */
const STAGE_NOW = {
  new: 'Сейчас — проектирование. Дальше — кнопка «В производство».',
  production: 'Сейчас — производство. Когда всё изготовлено — кнопка «Готово к отгрузке».',
  ready: 'Готов к отгрузке. Этап «Частично отгружен» / «Отгружен» поставится сам, когда оформите отгрузку.',
  partly: 'Отгружено частично. Когда отгрузите всё — этап «Отгружен» поставится сам.',
  shipped: 'Отгружено всё. Закройте заказ, когда работа и оплата завершены.',
};
const HINT = {
  new: 'Новые (входящие): ещё не в проектировании, не в производстве и не отгружены. Начните — «В производство» или передайте в проектирование.',
  active: 'Заказы в работе: проектирование, производство, готовые к отгрузке. Красный срок — просрочено.',
  done: 'Отгруженные и закрытые заказы — по месяцам отгрузки. Нажмите на месяц, чтобы раскрыть.',
};

/** Приоритет заказа: «обычный» не показываем. */
const prio = (r) => (r.priority && r.priority !== 'normal' ? badge(ORDER_PRIORITY, r.priority) : null);
/** № заказа = № на производство (productionNo); № договора (orderNo) — справка. Несколько договоров с одним № — один заказ производства. */
export const prodNo = (r) => r?.productionNo || 'нет №';
const heading = (r) => (r.productionNo ? `Заказ № ${r.productionNo}` : `Заказ без № · договор ${(r.orderNos || [r.orderNo])[0] || '—'}`);
const deadline = (r) => r.deadline || r.shipDate || r.productionDeadline || r.deliveryDeadline;
function due(r) {
  const d = deadline(r);
  if (!d) return h('span', { class: 'muted' }, '—');
  const late = !['shipped', 'closed', 'cancelled'].includes(r.stage) && new Date(d) < new Date(isoDay());
  return h('span', { class: late ? 'neg' : '', title: late ? 'Срок прошёл' : '' }, date(d));
}
/** Договор: свой этап (PATCH /salesorders/:id), с отменой. */
async function setContractStage(r, stage) {
  const saved = await api(`/salesorders/${r.id}`, { method: 'PATCH', body: { stage, ...(stage === 'shipped' && !r.shipDate ? { shipDate: isoDay() } : {}) } });
  toast(`Договор ${r.orderNo || ''} → ${STAGE[stage].label}`, { undo: async () => { await api(`/salesorders/${r.id}`, { method: 'PATCH', body: { stage: r.stage } }); window.dispatchEvent(new CustomEvent('data-changed')); } });
  return saved;
}
/** Следующий свободный № заказа; сбой — пусто (впишут руками). */
const freeNo = () => api('/salesorders/next-production-no').then((r) => r?.value || '', () => '');
/** Договоры заказа, которые отстают от этапа `stage` (отменённые не в счёт). */
const lagging = (r, stage) => (r.orders || []).filter((o) => o.stage !== 'cancelled' && STAGE_ORDER.indexOf(o.stage || 'new') < STAGE_ORDER.indexOf(stage));
/** Выбор договоров галочками: все отстающие отмечены. null — отказались, иначе id выбранных. */
function pickContracts(r, stage, list) {
  const cbs = list.map((o) => h('input', { type: 'checkbox', class: 'ua-cb', checked: true, value: o.id }));
  return modal({
    title: `${heading(r)}: «${STAGE[stage].label}»`, okText: 'Применить к выбранным',
    body: h('div', null, h('p', { class: 'muted' }, 'Отметьте договоры, у которых сменится этап. Остальные останутся как есть.'),
      h('div', { class: 'ua-list' }, ...list.map((o, i) => h('label', { class: 'ua-row' }, cbs[i],
        h('span', { class: 'ua-main' }, h('b', null, 'Договор ' + (o.orderNo || '—')), h('span', { class: 'muted' }, o.customer ? ' · ' + o.customer : '')),
        h('span', { class: 'muted small nowrap' }, 'сейчас: ' + (STAGE[o.stage || 'new']?.label || o.stage)))))),
    onOk: async () => { const ids = cbs.filter((c) => c.checked).map((c) => c.value); if (!ids.length) throw new Error('Отметьте хотя бы один договор'); return ids; },
  });
}
/** Заказ: следующий этап. Несколько отстающих договоров — выбор галочками; все выбраны — сервер подтягивает отстающие. null — отказались. */
async function setStage(r, stage) {
  // строка списка — без договоров: догрузить карточку, чтобы показать выбор
  if (!r.orders && (r.orderNos || []).length > 1) r = shape(await api(`/production-orders/${encodeURIComponent(r.key)}`));
  const list = lagging(r, stage);
  if (list.length > 1) {
    const ids = await pickContracts(r, stage, list);
    if (!ids) return null;
    if (ids.length < list.length) {
      for (const id of ids) await api(`/salesorders/${id}`, { method: 'PATCH', body: { stage } });
      toast(`${heading(r)} → ${STAGE[stage].label} (договоров: ${ids.length} из ${list.length})`);
      window.dispatchEvent(new CustomEvent('data-changed'));
      return shape(await api(`/production-orders/${encodeURIComponent(r.key)}`));
    }
  }
  const saved = await api(`/production-orders/${encodeURIComponent(r.key)}/stage`, { method: 'POST', body: { stage } });
  toast(`${heading(r)} → ${STAGE[stage].label}${saved?.changed?.length ? ` (договоров: ${saved.changed.length})` : ''}`);
  if (saved?.warnings?.length) toast('Не всё готово', { tone: 'warn', sub: saved.warnings.map((w) => (typeof w === 'string' ? w : w.label || w.hint || '')).filter(Boolean).join('; ') });
  return shape(saved);
}

/** Блок «Готовность к отгрузке» в карточке заказа: проверки сервера + кнопка «Отметить: готов к отгрузке». */
function readinessBlock(r, after) {
  const box = h('div', { class: 'so-sec rdy' });
  const paint = (d) => {
    const checks = d?.checks || [];
    const bad = checks.filter((c) => !c.ok);
    const can = session.canEdit && ['new', 'production'].includes(r.stage);
    const mark = async (btn) => {
      if (bad.length && !(await confirmDlg('Не выполнено: ' + bad.map((c) => c.label).join('; ') + '. Всё равно отметить?', 'Заказ перейдёт в «Готово к отгрузке».', { okText: 'Да, отметить' }))) return;
      btn.disabled = true; btn.classList.add('is-busy');
      try { await setStage(r, 'ready'); window.dispatchEvent(new CustomEvent('data-changed')); after?.(); } catch (e) { toast(errText(e)); } finally { btn.disabled = false; btn.classList.remove('is-busy'); }
    };
    const btn = can ? h('button', { class: 'btn ' + (bad.length ? 'btn-ghost' : 'btn-warm btn-primary'), type: 'button', onclick: (e) => mark(e.currentTarget) }, 'Отметить: готов к отгрузке') : null;
    box.replaceChildren(h('div', { class: 'section-title' }, 'Готовность к отгрузке'),
      ...checks.map((c) => h('div', { class: 'rdy-row' + (c.ok ? ' ok' : '') },
        h('span', { class: c.ok ? 'pos' : 'muted', 'aria-hidden': 'true' }, c.ok ? '✓' : '○'), ' ', h('span', null, c.label),
        !c.ok && c.hint ? h('span', { class: 'muted small' }, ' — ' + c.hint) : null,
        !c.ok && c.href ? h('a', { href: c.href.startsWith('#') ? c.href : '#' + c.href.replace(/^\//, ''), class: 'small' }, ' Открыть') : null)),
      btn);
  };
  api(`/production-orders/${encodeURIComponent(r.key)}/readiness`).then(paint).catch(() => box.replaceChildren());
  return box;
}

/** «Связать с каталогом»: предложения сервера по всем позициям без изделия → выбор → apply. Возвращает обновлённый заказ или null. */
async function matchProducts(r) {
  const res = await api(`/salesorders/${r.id}/match-products`, { method: 'POST', body: {} });
  const items = res?.items || [];
  if (!items.length) { toast('Все позиции уже с изделием'); return null; }
  const rows = items.map((it) => {
    const sel = h('select', null,
      ...(it.suggestions || []).map((s) => h('option', { value: s.productId }, `${s.name}${s.sku ? ' · ' + s.sku : ''}`)),
      h('option', { value: '' }, 'Без изделия'));
    return { it, sel, el: h('label', { class: 'field' }, h('span', null, `${it.lineNo ? it.lineNo + '. ' : ''}${it.title || ''}`), sel) };
  });
  const saved = await modal({
    title: 'Связать с каталогом', okText: 'Сохранить', wide: true,
    body: h('div', null, h('p', { class: 'hint' }, 'Первое предложение отмечено. Выберите «Без изделия», если подходящего нет.'), ...rows.map((x) => x.el)),
    onOk: async () => {
      const picks = rows.filter((x) => x.sel.value).map((x) => ({ lineId: x.it.lineId, productId: x.sel.value }));
      if (!picks.length) return {};
      const a = await api(`/salesorders/${r.id}/match-products`, { method: 'POST', body: { apply: true, picks } });
      toast(`Изделий привязано: ${a?.count ?? picks.length}`);
      return api(`/salesorders/${r.id}`);
    },
  });
  return saved && saved.id ? saved : null;
}

/** Быстрая строка «+ позиция» в карточке заказа: наименование, кол-во, ед. → Enter. Фото — в карточке позиции. */
let focusNewLine = false; // ТИ-8: после создания заказа сразу даём ввести первую позицию
const ourLine = (l) => {
  const our = l.product?.ourName || (l.productName && [l.sku || l.productSku, l.productName].filter(Boolean).join(' · '));
  if (our) return h('div', { class: 'muted small' }, 'Наше: ' + our);
  return l.productId || l.product ? null : h('div', { class: 'muted small' }, 'Свяжите с каталогом');
};
function addLineRow(r, after) {
  const title = h('input', { placeholder: 'Новая позиция: наименование (Enter — добавить)', maxlength: 500 });
  const q = h('input', { inputmode: 'decimal', value: '1', class: 'so-q', 'aria-label': 'Количество' });
  const unit = h('select', { 'aria-label': 'Ед. изм.' }, ...['шт', 'компл', 'пара', 'м', 'м²', 'кг'].map((u) => h('option', { value: u }, u)));
  const btn = h('button', { class: 'btn btn-primary btn-sm', type: 'button' }, 'Добавить');
  const go = async () => {
    const name = title.value.trim();
    if (!name) { title.focus(); return; }
    btn.disabled = true;
    try {
      const line = await api('/incomes', { method: 'POST', body: { orderId: r.id, title: name, qty: parseNum(q.value) || 1, unit: unit.value, clientUid: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) } });
      toast(`Позиция добавлена — откройте её, чтобы добавить фото и сумму`);
      title.value = ''; q.value = '1';
      window.dispatchEvent(new CustomEvent('data-changed'));
      after(line);
    } catch (e) { toast(errText(e), { error: true }); } finally { btn.disabled = false; }
  };
  title.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
  btn.addEventListener('click', go);
  if (focusNewLine) { focusNewLine = false; setTimeout(() => { title.scrollIntoView?.({ block: 'center' }); title.focus(); }, 50); }
  return h('div', { class: 'so-add' }, title, q, unit, btn);
}

/** «Выдано со склада» по позициям заказа (SK-5b): нетто = выдано − возвращено; позиция — «552-2 · название». */
function issuedBlock(d, sec) {
  const by = d.issuedByLine || [];
  if (!by.length) return '';
  const lines = d.lines || [];
  const groups = new Map();
  for (const x of by) { const k = x.salesOrderLineId ? String(x.salesOrderLineId) : ''; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(x); }
  const title = (k) => { if (!k) return 'Весь заказ (без позиции)'; const i = lines.findIndex((l) => String(l.id) === k); return i < 0 ? 'Позиция заказа' : `${d.productionNo || d.orderNo || ''}-${lines[i].seqNo ?? lines[i].lineNo ?? i + 1} · ${lines[i].title}`; };
  return sec(`Выдано со склада по позициям (${groups.size})`, h('ul', { class: 'timeline' }, ...[...groups].flatMap(([k, xs]) => xs.map((x, i) => h('li', i ? { class: 'tl-cont' } : null,
    i === 0 ? h('span', { class: 'tl-line', title: title(k) }, title(k)) : null, h('span', null, x.materialName || 'позиция'),
    h('span', { class: 'num neg', title: 'Выдано минус возвращено' }, qty(x.net) + ' ' + (x.unit || '')),
    h('span', { class: 'muted' }, `выдано ${qty(x.issued)}${x.returned ? ', возвращено ' + qty(x.returned) : ''}`),
    i === 0 && k && lines.find((l) => String(l.id) === k)?.productId ? suggestLink(k) : null)))));
}

/** Строка «Паспорта N (готовы M)» → вкладка «По заказам» (ТИ-11). */
function orderPassports(r) {
  if (!session.seesDocs()) return null;
  const val = h('span', { class: 'muted' }, 'загрузка…');
  api('/passports', { query: { salesOrderId: r.id, limit: 200 } }).then((d) => {
    const items = (d.items || []).filter((p) => p.status !== 'annulled');
    const ready = items.filter((p) => (p.readiness || (p.status === 'draft' ? 'notReady' : 'ready')) === 'ready').length;
    val.replaceChildren(items.length ? h('a', { href: '#docs?tab=orders&open=' + r.id }, `Паспорта ${items.length} (готовы ${ready})`) : 'пока не выпускали — «Документация → Нужно сделать паспорт»');
  }).catch((e) => val.replaceChildren(e?.status === 403 ? 'Нет доступа к паспортам' : 'не удалось загрузить'));
  return h('div', { class: 'so-sec' }, h('div', { class: 'section-title' }, 'Паспорта'), val);
}

const sec = (title, ...kids) => h('div', { class: 'so-sec' }, h('div', { class: 'section-title' }, title), ...kids);
const seq = (l, i) => l.seqNo ?? l.lineNo ?? i + 1;
const closedStage = (o) => ['closed', 'cancelled'].includes(o.stage);

/** Группа «Договор 109-П»: шапка с кнопками, позиции (сквозной №), «ещё» — паспорта, отгрузки, склад (строится при раскрытии). */
function contractGroup(o, reload) {
  const lines = o.lines || [];
  const seeReq = session.sees('requests'), seeStock = session.sees('stock');
  const acts = [];
  if (session.canEdit) acts.push(h('button', { class: 'btn btn-ghost btn-sm', type: 'button', title: 'Изменить договор: № договора, заказчик, этап, срок, примечание', onclick: () => patch({ of: 'salesorder', open: o.id }, { replace: false }) }, 'Изменить договор'));
  if (!['closed', 'cancelled', 'new'].includes(o.stage) && canShip()) acts.push(h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => patch({ of: 'shipdo', open: o.id }, { replace: false }) }, 'Отгрузить'));
  if (!closedStage(o) && session.canEdit && session.sees('stock')) acts.push(h('button', { class: 'btn btn-ghost btn-sm', type: 'button', title: 'Файл Excel → брони под позиции этого договора', onclick: () => patch({ of: 'specimport', new: '1', orderId: o.id, open: undefined }, { replace: false }) }, 'Спецификация'));
  // удалить договор прямо из строки (было только в «⋯» карточки — не находили; пользователь 2026-10-29), пароль — как в карточке
  if (session.canEdit) acts.push(h('button', { class: 'btn btn-ghost btn-sm so-del', type: 'button', title: 'Удалить договор в корзину (нужен ваш пароль)', onclick: async () => {
    if (!(await confirmDlg('Удалить?', salesorders.remove.text(o) + ' Её можно будет восстановить из корзины.', { okText: 'Удалить', danger: true }))) return;
    try {
      if ((await withConfirm(async () => { await salesorders.remove.run(o); return true; }, { text: 'Удаление требует вашего пароля.' })) === null) return;
      toast('Договор с заказчиком удалён'); window.dispatchEvent(new CustomEvent('data-changed')); reload?.();
    } catch (e) { toast(errText(e)); }
  } }, 'Удалить'));
  const head = h('div', { class: 'so-grp-head' },
    h('div', { class: 'so-grp-title' }, h('b', null, 'Договор ' + (o.orderNo || '—')), h('span', { class: 'muted' }, o.customer ? ' · ' + o.customer : ''), ' ', badge(STAGE, o.stage), ' ', due(o)),
    acts.length ? h('div', { class: 'so-grp-acts' }, ...acts) : null);
  // «Оплачено» / «Долг» и «Принять оплату» — только с правом на деньги (приём оплаты — панель incpay, она же из карточки позиции)
  const payOn = session.canMoney && session.canEdit;
  const paidOf = (l) => (Number(l.paidAmount) || (l.paidDate ? Number(l.amount) || 0 : 0));
  const payCells = (l) => {
    if (!session.canMoney) return [];
    const debt = Math.max(0, (Number(l.amount) || 0) - paidOf(l));
    return [
      h('td', { class: 'num nowrap muted' }, paidOf(l) ? money(paidOf(l)) : ''),
      h('td', { class: 'num nowrap' }, l.amount ? (debt > 0 ? money(debt) : h('span', { class: 'muted' }, '—')) : ''),
      ...(payOn ? [h('td', { class: 'nowrap' }, l.amount && debt > 0 ? h('button', { class: 'btn btn-ghost btn-sm', type: 'button', title: 'Принять оплату по этой позиции', onclick: (e) => { e.stopPropagation(); patch({ of: 'incpay', open: String(l.id), new: undefined }, { replace: false }); } }, 'Принять оплату') : '')] : []),
    ];
  };
  const table = lines.length
    ? h('table', { class: 'so-lines' }, h('thead', null, h('tr', null, h('th', null, '№'), h('th', null, ''), h('th', null, 'Название'), h('th', { class: 'num' }, 'Кол-во'), h('th', { class: 'num' }, 'Отгружено'), h('th', null, 'Цвет'), session.canMoney ? h('th', { class: 'num' }, 'Сумма') : null, session.canMoney ? h('th', { class: 'num' }, 'Оплачено') : null, session.canMoney ? h('th', { class: 'num' }, 'Долг') : null, payOn ? h('th', null, '') : null)),
      h('tbody', null, ...lines.map((l, i) => h('tr', { onclick: () => patch({ of: 'orders', open: l.id }, { replace: false }), title: 'Открыть позицию: фото, сумма, отгрузка, оплата (назад — к заказу)' },
        h('td', { class: 'muted' }, seq(l, i)), h('td', { class: 'pic-cell' }, l.photo ? h('img', { class: 'pic so-pic', src: PREFIX + (l.photo.thumb || l.photo.url), alt: '', loading: 'lazy', title: 'Открыть фото', onclick: (e) => { e.stopPropagation(); window.open(PREFIX + l.photo.url, '_blank'); }, onerror: (e) => e.target.remove() }) : null), h('td', null, l.title, ourLine(l), l.matched === false ? h('a', { class: 'badge warn mt-flag', href: '#', title: 'Сопоставить позиции договора с изделиями', onclick: (e) => { e.preventDefault(); e.stopPropagation(); patch({ of: 'matching', open: o.id, new: undefined }, { replace: false }); } }, 'не сопоставлено') : null), h('td', { class: 'num nowrap' }, `${qty(l.qty)} ${l.unit || ''}`),
        h('td', { class: 'num nowrap muted' }, l.shipped ? `${qty(l.shipped)} из ${qty(l.qty)}` : ''), h('td', { class: 'muted' }, l.color || ''), session.canMoney ? h('td', { class: 'num' }, l.amount ? money(l.amount) : '') : null, ...payCells(l)))))
    : h('p', { class: 'muted' }, 'В этом договоре позиций пока нет — добавьте ниже.');
  const add = session.canEdit && !closedStage(o) ? (o.stage === 'new' || session.role === 'admin' ? addLineRow(o, reload) : h('p', { class: 'hint' }, 'Договор уже в работе — менять позиции может администратор.')) : null;
  const more = h('details', { class: 'so-more' }, h('summary', null, 'Паспорта, отгрузки, проектирование, склад'));
  let built = false;
  more.addEventListener('toggle', () => {
    if (!more.open || built) return; built = true;
    const seqBy = new Map(lines.map((l, i) => [String(l.id), seq(l, i)]));
    more.append(...[
      orderPassports(o),
      shipmentsBlock({ id: o.id, stage: o.stage }, reload),
      historyBlock({ id: o.id }),
      orderDesign({ id: o.id, orderNo: o.productionNo || o.orderNo }, lines),
      seeReq ? sec(`Заказано под заказ (${(o.supplyRequests || []).length})`,
        (o.supplyRequests || []).length ? h('ul', { class: 'timeline' }, ...o.supplyRequests.map((s) => h('li', null, h('a', { href: '#requests?open=' + (s.id || s._id) }, `№${s.num ?? ''} ${s.title}`), h('span', { class: 'muted' }, ` · ${qty(s.qty)} ${s.unit || ''} · ${s.statusLabel || s.status || ''}`)))) : h('p', { class: 'muted' }, 'Заявок под этот заказ пока нет.'),
        h('button', { class: 'btn btn-sm', type: 'button', title: 'Новая заявка: заказ и заказчик подставятся сами', onclick: () => patch({ of: 'requests', new: '1', open: undefined, salesOrderRef: o.id, orderLabel: o.customer || undefined }) }, '+ Заявка под этот заказ')) : null,
      seeStock ? orderReservations({ id: o.id, orderNo: o.orderNo, productionNo: o.productionNo, seqBy }, reload) : null,
      seeStock ? issuedBlock(o, sec) : null,
      seeStock && (o.stockMovements || []).length ? sec(`Отпущено со склада (${o.stockMovements.length})`,
        h('ul', { class: 'timeline' }, ...o.stockMovements.map((m) => h('li', null, h('span', { class: 'when' }, date(m.date)), h('span', null, m.materialName || 'позиция'), h('span', { class: 'num neg' }, '−' + qty(m.qty)), h('span', { class: 'muted' }, [m.issuedToLabel && 'кому: ' + m.issuedToLabel, m.notes].filter(Boolean).join(' · ')))))) : null,
    ].filter((x) => x != null && x !== false && x !== ''));
  });
  return h('div', { class: 'so-grp' }, head, table, add, more);
}

/** «К производству»: одинаковые позиции всех договоров заказа сложены вместе (только просмотр). */
function produceBlock(d) {
  const t = d.toProduce || [];
  if (!t.length) return null;
  return sec(`К производству (${t.length})`,
    h('table', { class: 'so-lines' }, h('thead', null, h('tr', null, h('th', null, '№'), h('th', null, 'Изделие'), h('th', { class: 'num' }, 'Кол-во'), h('th', null, 'Ед. изм.'), h('th', null, 'Из позиций'))),
      h('tbody', null, ...t.map((x, i) => h('tr', null, h('td', { class: 'muted' }, i + 1), h('td', null, x.title), h('td', { class: 'num nowrap' }, qty(x.qty)), h('td', { class: 'muted' }, x.unit || ''), h('td', { class: 'muted' }, (x.seqNos || []).join(', ')))))),
    h('p', { class: 'hint' }, 'Одинаковые позиции всех договоров заказа сложены вместе — чтобы запустить в работу сразу всё. Это только просмотр.'));
}

const inWork = (d) => !['new', 'closed', 'cancelled'].includes(d.stage);
const plateOf = (d) => { const u = unmatchedOrders(d); return u.length ? unmatchedPlate(u.reduce((s, x) => s + x.n, 0), u[0].id) : null; };

function details(r) {
  const box = h('div', null);
  const paint = (d) => box.replaceChildren(...[
    inWork(d) ? plateOf(d) : null,
    produceBlock(d),
    ['closed', 'cancelled', 'shipped', 'ready', 'partly'].includes(d.stage) ? null : readinessBlock(d, reload),
    ['closed', 'cancelled'].includes(d.stage) ? null : orderWork(d.orders),
    sec(`Договоры (${(d.orders || []).length})`, ...((d.orders || []).length ? d.orders.map((o) => contractGroup(o, reload)) : [h('p', { class: 'muted' }, 'Договоров нет.')])),
  ].filter(Boolean));
  const reload = () => api(`/production-orders/${encodeURIComponent(r.key)}`).then((d) => paint(d)).catch((e) => box.replaceChildren(failBlock(e, reload)));
  if (r.orders) paint(r); else { box.append(h('div', { class: 'muted' }, 'Загрузка…')); reload(); }
  return box;
}

const uniq = (a) => [...new Set(a.filter(Boolean))];
/** Номера активных заказов для поля «№ заказа»: кэш 90 с (SPEED-2), сбрасывается любой записью в заказы. */
let nosP = null; let nosAt = 0;
const activeOrderNos = () => {
  if (!nosP || Date.now() - nosAt > 90000) { nosAt = Date.now(); const p = api('/production-orders', { query: { filter: 'active', limit: 200, sort: '-createdAt' } }).then((r) => uniq((r.items || []).map((x) => x.productionNo))); nosP = p; p.catch(() => { if (nosP === p) nosP = null; }); }
  return nosP;
};
writeHooks.push((path) => { if (/^\/(salesorders|production-orders)(\/|$)/.test(path)) nosP = null; });
const sumOf = (os, k) => os.reduce((s, o) => s + (Number(o[k]) || 0), 0);
/** Карточка заказа с сервера → вид строки раздела (id = key). */
function shape(d) {
  const os = d.orders || [];
  return { ...d, id: d.key, orderNos: os.map((o) => o.orderNo), customers: uniq(os.map((o) => o.customer)), companyNames: uniq(os.map((o) => o.companyName)),
    lineCount: os.reduce((s, o) => s + (o.lineCount ?? (o.lines || []).length), 0), amount: sumOf(os, 'amount'), paidAmount: sumOf(os, 'paidAmount') };
}
const stageCell = (r) => h('span', null, badge(STAGE, r.stage), r.readiness?.ready && ['new', 'production'].includes(r.stage) ? h('span', { class: 'tag ok', title: 'Все проверки пройдены, изготовленное готово — можно отметить «Готово к отгрузке»' }, ' Можно отгружать') : null, r.stagesDiffer ? h('span', { class: 'muted small', title: 'У договоров заказа разные этапы — показан самый отстающий' }, ' · разные') : null);
const names = (a) => (a || []).join(', ');

export const salesorders = {
  id: 'salesorders',
  title: 'Заказы',
  entityType: 'SalesOrder',
  // карточка — заказ производства (key = № заказа или id договора без №); старые ссылки по id договора находят свой заказ
  get: async (id) => {
    try { return shape(await api(`/production-orders/${encodeURIComponent(id)}`)); }
    catch (e) {
      if (e?.status !== 404 || !/^[0-9a-f]{24}$/i.test(String(id))) throw e;
      const o = await api(`/salesorders/${id}`);
      return shape(await api(`/production-orders/${encodeURIComponent(o.productionNo || id)}`));
    }
  },

  list: {
    viewKey: 'salesorders', path: '/production-orders',
    map: (r) => ({ ...r, id: r.key }),
    export: 'admin',
    sortDefault: 'deadline',
    createLabel: false,
    headActions: () => [h('button', { class: 'btn btn-primary', type: 'button', title: 'Новый заказ (договор): № заказа можно взять существующий — договоры объединятся в один заказ', onclick: () => patch({ of: 'salesorder', new: '1', open: undefined }, { replace: false }) }, '+ Заказ')],
    searchPlaceholder: 'Поиск: № заказа, № договора, заказчик, предмет…',
    extraKeys: ['productId'], query: (P) => ({ productId: P.productId || undefined }),
    emptyText: 'Заказов пока нет.',
    emptyHint: 'Нажмите «+ Заказ»: № заказа, заказчик, срок. Договоры с одним № заказа объединяются в один заказ.',
    rowClass: (r) => r.stage === 'new' ? 'so-design-row' : '',
    filters: [
      // вкладки: Новые → В работе (по умолчанию) → Закрытые → Все в конце (пользователь 2026-10-28)
      { key: 'filter', label: 'Статус', type: 'chips', defaultValue: 'active', noAll: true, options: () => [{ value: 'new', label: 'Новые' }, { value: 'active', label: 'В работе' }, { value: 'done', label: 'Закрытые' }, { value: 'all', label: 'Все' }], count: (resp, v) => (v === 'new' ? resp.counts?.fresh : resp.counts?.[v]) },
    ],
    top: (reload) => h('div', null, unmatchedTop(), unassignedTop(reload)),
    hints: HINT,
    hintKey: 'filter',
    periods: (P) => (P.filter === 'done' ? { date: (r) => r.deadline || r.createdAt, total: session.canMoney ? (rs) => money(rs.reduce((s, r) => s + (Number(r.amount) || 0), 0)) : undefined } : null),
    rowAction: (r) => (NEXT[r.stage] ? { label: NEXT_LABEL[r.stage], title: NEXT_TIP[r.stage], run: (row) => setStage(row, NEXT[row.stage]) } : null),
    columns: [
      { key: 'productionNo', label: '№ заказа', sort: 'productionNo', cls: 'nowrap', render: (r) => (r.productionNo ? h('b', null, r.productionNo) : h('span', { class: 'muted' }, 'нет №')) },
      { key: 'orderNos', label: 'Договоры', cls: 'clip md-hide', render: (r) => h('span', { class: 'muted small', title: names(r.orderNos) }, names(r.orderNos) || '—') },
      { key: 'customer', label: 'Заказчик', sort: 'customer', cls: 'clip', render: (r) => h('span', { title: names(r.customers) }, names(r.customers)) },
      { key: 'companyName', label: 'Наша компания', cls: 'md-hide', render: (r) => names(r.companyNames) || h('span', { class: 'muted' }, '—') },
      { key: 'lineCount', label: 'Поз.', cls: 'num right', render: (r) => qty(r.lineCount) },
      { key: 'deadline', label: 'Срок', sort: 'deadline', cls: 'nowrap', render: due },
      { key: 'amount', money: true, label: 'Сумма', cls: 'num right md-hide', render: (r) => (r.amount ? money(r.amount) : h('span', { class: 'muted' }, '—')) },
      { key: 'priority', label: 'Приоритет', cls: 'nowrap md-hide', render: (r) => prio(r) || '' },
      { key: 'stage', label: 'Этап', cls: 'nowrap', render: stageCell },
    ],
    card: {
      title: (r) => `№ ${prodNo(r)} · ${names(r.customers)}`,
      sub: (r) => [(r.orderNos || []).length && 'договоры ' + names(r.orderNos), `${r.lineCount} поз.`, r.deadline ? 'срок ' + date(r.deadline) : ''].filter(Boolean).join(' · '),
      side: (r) => [badge(STAGE, r.stage), prio(r)],
    },
    board: {
      default: true,
      map: (r) => ({ ...r, id: r.key }),
      columns: ['new', 'production', 'ready', 'partly', 'shipped'].map((k) => ({ key: k, label: STAGE[k].label, tone: STAGE[k].tone, query: { stage: k, sort: k === 'shipped' ? '-deadline' : 'deadline' } })),
      card: (r) => ({
        title: `№ ${prodNo(r)} · ${names(r.customers)}`,
        meta: [(r.orderNos || []).length ? h('span', { class: 'muted' }, 'договоры ' + names(r.orderNos)) : null, h('span', null, `${r.lineCount} поз.`), r.deadline ? due(r) : null, r.stagesDiffer ? h('span', { class: 'muted' }, 'разные этапы') : null, prio(r), unmatchedOrders(r)[0] ? unmatchedFlag(unmatchedOrders(r)[0].id) : null].filter(Boolean),
        side: r.amount && session.canMoney ? money(r.amount) : '',
      }),
      move: async (r, to) => !!(await setStage(r, to)),
    },
  },

  card: {
    heading,
    noHistory: true,
    subheading: (r) => [names(r.customers), names(r.companyNames)].filter(Boolean).join(' · '),
    stats: (r) => [['Этап', STAGE[r.stage]?.label || r.stage], ['Договоров', qty((r.orderNos || []).length)], ['Позиций', qty(r.lineCount)], ...(session.canMoney ? [['Сумма', r.amount ? money(r.amount) : '—'], ['Оплачено', r.paidAmount ? money(r.paidAmount) : '—']] : [])],
    view: (r) => [
      ['Договоры', names(r.orderNos)],
      ['Заказчик', (r.customers || []).length ? h('span', null, ...(r.customers || []).flatMap((c, i) => [i ? ', ' : '', customerLink(c)])) : ''],
      ['Наша компания', names(r.companyNames) || h('span', { class: 'muted' }, 'не указана')],
      ['Срок', r.deadline ? due(r) : ''],
      ['Приоритет', r.priority && r.priority !== 'normal' ? prio(r) : ''],
      ['Что дальше', STAGE_NOW[r.stage] ? h('span', { class: 'muted' }, STAGE_NOW[r.stage]) : ''],
      ['Этапы по договорам', r.stagesDiffer ? h('span', null, ...(r.orders || []).flatMap((o, i) => [i ? h('br') : '', `${o.orderNo || '—'}: ${STAGE[o.stage]?.label || o.stage}`])) : ''],
    ],
    actions: (r) => {
      const many = NEXT[r.stage] && lagging(r, NEXT[r.stage]).length > 1;
      return [
        NEXT[r.stage] && { label: NEXT_LABEL[r.stage], title: NEXT_TIP[r.stage] + (many ? ' Договоры выберете галочками.' : ''), primary: true, run: async (row, ctx) => { const s = await setStage(row, NEXT[row.stage]); if (s) ctx.setRow(s); } },
        !closedStage(r) && r.productionNo && session.canEdit && { label: '+ Добавить договор', title: 'Выбрать договоры без заказа и добавить их в этот заказ', run: async (row, ctx) => { if (await addContractsDialog(row.productionNo, null)) { const s = await salesorders.get(row.key || row.id); if (s) ctx.setRow(s); } } },
        !closedStage(r) && { label: '+ Договор с заказчиком в этот заказ', title: 'Новый договор с этим № заказа', run: (row) => patch({ of: 'salesorder', new: '1', productionNo: row.productionNo || '', customer: names(row.customers) && (row.customers || [])[0] || '', open: undefined }, { replace: false }) },
      ];
    },
    extra: (r) => details(r),
  },
};

/** Договор (`salesorders`): правка шапки, отмена, удаление. Открывается из группы в карточке заказа. */
export const salesorder = {
  id: 'salesorder',
  title: 'Договор с заказчиком',
  newTitle: 'Новый договор',
  entityType: 'SalesOrder',
  historyLabels: { 'salesorder.created': 'Создан', 'salesorder.updated': 'Изменён', 'salesorder.deleted': 'Удалён', 'salesorder.restored': 'Восстановлен' },
  get: (id) => api(`/salesorders/${id}`),

  card: {
    heading: (r) => `Договор ${r.orderNo || '—'}`,
    subheading: (r) => [r.customer, r.companyName].filter(Boolean).join(' · '),
    parent: (r) => ({ label: `Заказ № ${prodNo(r)}`, run: () => patch({ of: undefined, open: r.productionNo || r.id }, { replace: false }) }),
    editTop: true,
    extra: (r) => handoffLine('salesorder', r.id),
    stats: (r) => [['Этап', STAGE[r.stage]?.label || r.stage], ['Позиций', qty(r.lineCount)], ...(session.canMoney ? [['Сумма', r.amount ? money(r.amount) : '—'], ['Оплачено', r.paidAmount ? money(r.paidAmount) : '—']] : [])],
    view: (r) => [
      ['№ заказа', r.productionNo || h('span', { class: 'muted' }, 'нет №')],
      ['Заказчик', customerLink(r.customer)],
      ['Предмет', r.title],
      ['Наша компания', r.companyName || h('span', { class: 'muted' }, 'не указана')],
      ['Приоритет', r.priority && r.priority !== 'normal' ? prio(r) : ''],
      ['Ответственный', r.responsible],
      ['Форма оплаты', r.paymentForm],
      ['№ госконтракта', [r.contractNo, r.contractDate && 'от ' + date(r.contractDate)].filter(Boolean).join(' ')],
      ['Срок изготовления', date(r.productionDeadline)],
      ['Дата отгрузки', date(r.shipDate)],
      ['Окончание поставки', date(r.deliveryDeadline)],
      ['Примечание', r.notes],
    ],
    actions: (r) => [
      NEXT[r.stage] && { label: NEXT_LABEL[r.stage], run: async (row, ctx) => ctx.setRow(await setContractStage(row, NEXT[row.stage])) },
      r.stage !== 'cancelled' && !['shipped', 'closed'].includes(r.stage) && { label: 'Отменить договор с заказчиком', run: async (row, ctx) => { if (!(await confirmDlg(`Отменить договор с заказчиком ${row.orderNo || ''}?`, 'Договор перейдёт в «Отменён» и уйдёт из «В работе». Брони и заявки не удаляются — снимите их отдельно. Вернуть можно сменой этапа.', { okText: 'Да, отменить договор с заказчиком', danger: true }))) return; ctx.setRow(await setContractStage(row, 'cancelled')); } },
      !closedStage(r) && ['admin', 'manager'].includes(session.role) && { label: 'Связать с каталогом', title: 'Связать позиции заказчика с нашими изделиями — для паспорта и производства. Договор не меняется.', run: async (row, ctx) => { const s = await matchProducts(row); if (s) ctx.setRow(s); } },
      session.canMoney && session.canEdit && { label: '+ Позиция', run: (row) => patch({ of: 'orders', new: '1', open: undefined, orderNo: row.orderNo || '', customer: row.customer || '', companyName: row.companyName || '', orderId: row.id }, { replace: false }) },
    ],
  },

  form: {
    fields: async (row) => {
      const [l, nums] = await Promise.all([
        incomeLookups().catch(() => ({ companies: [], customers: [], paymentForms: ['б/р', 'б/р 30%', 'б/р 50%', 'нал'] })),
        activeOrderNos().catch(() => []),
      ]);
      return [
        { section: 'Договор с заказчиком', tone: 'main', fixed: true },
        { key: 'productionNo', label: '№ заказа', type: 'combo', required: true, options: nums, max: 50,
          hint: row ? 'Номер для производства, например 21-26: номер и год. Выберите № из списка — договор войдёт в этот заказ.'
            : 'Подставлен свободный №. Выберите № из списка — договор войдёт в этот заказ. Очистите поле — снова встанет свободный.',
          // новый заказ: пустое поле после правки — снова свободный №
          mount: (fa) => { if (row) return; const inp = fa.input('productionNo'); (inp?.el || inp)?.addEventListener?.('change', async () => { if (!String(fa.get('productionNo')).trim()) { const v = await freeNo(); if (v && !String(fa.get('productionNo')).trim()) fa.set('productionNo', v, { auto: true }); } }); } },
        { key: 'orderNo', label: '№ договора', required: true, max: 50 },
        { key: 'customer', label: 'Заказчик', type: 'combo', required: true, options: l.customers, max: 300 },
        { key: 'title', label: 'Предмет заказа', wide: true, max: 1000 },
        { key: 'companyName', label: 'Наша компания', type: 'select', required: true, choose: true, hint: 'Выбирайте каждый раз — от компании зависят документы.', options: l.companies.map((c) => c.name) },
        { key: 'paymentForm', label: 'Форма оплаты', type: 'combo', options: l.paymentForms, max: 50 },
        { key: 'stage', label: 'Этап', type: 'select', required: true, options: Object.entries(STAGE).map(([value, s]) => ({ value, label: s.label })) },
        await responsibleField('Кому передан договор. Смена записывается в историю передач.'),
        { key: 'priority', label: 'Приоритет', type: 'select', required: true, options: Object.entries(ORDER_PRIORITY).map(([value, p]) => ({ value, label: p.label })), hint: 'Срочные заказы выделяются в «Проектировании» и в списках.' },
        { section: 'Сроки', tone: 'info' },
        { key: 'productionDeadline', label: 'Срок изготовления', type: 'date' },
        { key: 'shipDate', label: 'Дата отгрузки', type: 'date' },
        { key: 'deliveryDeadline', label: 'Окончание поставки', type: 'date' },
        { section: 'Контракт и примечание', tone: 'who', collapsed: true },
        { key: 'contractNo', label: '№ госконтракта', max: 100 },
        { key: 'contractDate', label: 'Дата контракта', type: 'date' },
        { key: 'notes', label: 'Примечание', type: 'textarea', wide: true },
      ];
    },
    initial: async () => ({ stage: 'new', paymentForm: 'б/р', priority: 'normal', productionNo: await freeNo() }),
    toInitial: (r) => ({ ...r, priority: r.priority || 'normal', ...Object.fromEntries(['shipDate', 'productionDeadline', 'deliveryDeadline', 'contractDate'].map((k) => [k, r[k] ? String(r[k]).slice(0, 10) : ''])) }),
    toBody: (v) => {
      const s = (x) => (x === null ? '' : String(x));
      return { orderNo: s(v.orderNo), productionNo: s(v.productionNo), customer: s(v.customer), title: s(v.title), companyName: s(v.companyName), paymentForm: s(v.paymentForm), stage: v.stage, priority: v.priority === 'normal' ? '' : v.priority || '',
        ...('responsibleId' in v ? { responsibleId: v.responsibleId || '' } : {}),
        productionDeadline: v.productionDeadline || '', shipDate: v.shipDate || '', deliveryDeadline: v.deliveryDeadline || '', contractNo: s(v.contractNo), contractDate: v.contractDate || '', notes: s(v.notes), requireFields: true };
    },
    create: (body) => api('/salesorders', { method: 'POST', body: { ...body, clientUid: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) } }).then((r) => { focusNewLine = true; return r; }),
    update: (id, body) => api(`/salesorders/${id}`, { method: 'PATCH', body }),
  },

  remove: { password: true,
    text: (r) => `Удалить договор ${r.orderNo || ''} (${r.customer || 'без заказчика'})? Позиции останутся в «Позициях заказов», заявки и брони тоже. Отменённый договор остаётся в списке; удаление — в корзину.`,
    run: (r) => api(`/salesorders/${r.id}`, { method: 'DELETE' }),
    restore: (r) => api(`/salesorders/${r.id}/restore`, { method: 'POST' }),
  },

  searchRow: (r) => ({ title: `Заказ № ${prodNo(r)} · ${r.customer || ''}`, sub: [r.orderNo && 'договор ' + r.orderNo, r.title, `${r.lineCount} поз.`].filter(Boolean).join(' · '), side: badge(STAGE, r.stage) }),
  open: (id) => go('salesorders', { open: id }),
};

/** Выбор заказа и позиции (для заявок и списаний, З.6): заказы в работе. Кэш на 1 минуту (core/orders-lookup.js). */
// SK-8d: короткий список (/salesorders/lookup) — открыт и для «Склада», «Заявок»; кэш — в core/orders-lookup.js
export const activeOrders = () => ordersLookup({ filter: 'active' });
export const orderLabel = (o) => [`№ ${prodNo(o)}`, o.orderNo && `договор ${o.orderNo}`, o.customer].filter(Boolean).join(' · ');

/** Варианты «Заказ / позиция» для выпадающего списка (З.6): «id» — весь заказ, «id:lineId» — позиция. */
export async function orderOptions(keep) {
  // SK-8d: заказы в работе сразу с позициями — без /incomes?limit=3000 (раздел «Позиции и оплаты» может быть закрыт)
  const orders = await ordersLookup({ filter: 'active', lines: true });
  const opts = [];
  for (const o of orders) {
    opts.push({ value: o.id, label: orderLabel(o) + ' — весь заказ' });
    for (const l of o.lines || []) opts.push({ value: o.id + ':' + l.id, label: `   └ ${seq(l, -1) ? seq(l, -1) + '. ' : ''}${String(l.title || '').slice(0, 70)}` });
  }
  if (keep && !opts.some((x) => x.value === keep)) opts.unshift({ value: keep, label: 'Заказ (выполнен или удалён)' });
  return opts;
}
export const splitRef = (ref) => { const [o, l] = String(ref || '').split(':'); return { salesOrderId: o || '', salesOrderLineId: l || '' }; };
export const joinRef = (r) => (r.salesOrderId ? String(r.salesOrderId) + (r.salesOrderLineId ? ':' + String(r.salesOrderLineId) : '') : '');
