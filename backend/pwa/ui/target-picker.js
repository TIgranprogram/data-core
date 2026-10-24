import { api, PREFIX } from '../core/api.js';
import { h } from '../core/dom.js';
import { qty } from '../core/format.js';
import { normSearch, searchTokens } from '../core/facets.js';
import { activeOrders, orderLabel } from '../sections/salesorders.js';
import { peopleByWork, withOrders } from '../sections/issue.js';
import { attachCombo } from './combo.js';
import { errText } from './errors.js';
import { enhanceSelect } from './select.js';

/*
 * «Кому / под что» при выдаче и возврате (SK-5b). Заказы и позиции не грузятся при открытии панели:
 * список заказов — по первому нажатию в поле «Заказ», позиции — при выборе заказа (GET /salesorders/:id/lines-lookup).
 *   const tp = targetPicker({ mode: 'out' | 'return' })
 *   tp.el, tp.value() → { salesOrderId?, salesOrderLineId?, personId?, issuedTo? }, tp.check() → текст ошибки или '',
 *   tp.orderId() → id выбранного заказа или '', tp.dirty() → что-то выбрано/вписано, tp.reset()
 * mode 'out': «Под заказ» (заказ → позиция с картинкой / весь заказ, плюс необязательно сотрудник) · «Сотруднику» · «Просто выдано» (текст по желанию).
 * mode 'return': только заказ → позиция (возврат со сборки).
 */

// ---------- позиции заказа и картинки (общий кэш; запросы по очереди — лимит сервера 10/с) ----------
let queue = Promise.resolve();
const inQueue = (fn) => { const r = queue.then(fn, fn); queue = r.catch(() => {}); return r; };
const linesCache = new Map();
/** Позиции заказа: [{ id, orderNo, lineNo, title, photoId, qty }]. Один запрос на заказ. */
export function orderLines(orderId) {
  if (!linesCache.has(orderId)) linesCache.set(orderId, inQueue(() => api(`/salesorders/${orderId}/lines-lookup`)).catch((e) => { linesCache.delete(orderId); throw e; }));
  return linesCache.get(orderId);
}
const photoCache = new Map();
const photoUrl = (l) => {
  if (l.photoThumb || l.photoUrl) return Promise.resolve(l.photoThumb || l.photoUrl);
  if (!l.photoId) return Promise.resolve('');
  if (!photoCache.has(l.photoId)) photoCache.set(l.photoId, inQueue(() => api('/photos/' + l.photoId)).then((p) => p.storageUrl || '').catch(() => ''));
  return photoCache.get(l.photoId);
};
/** «552-2» — номер заказа и номер позиции. */
export const lineCode = (l) => [l.orderNo, l.lineNo].filter((x) => x !== null && x !== undefined && x !== '').join('-');

function picBox(l) {
  const box = h('div', { class: 'sg-pic sg-pic-none' });
  if (l.photoId || l.photoThumb || l.photoUrl) photoUrl(l).then((u) => { if (u) box.replaceWith(h('img', { class: 'sg-pic', src: PREFIX + u, alt: '', loading: 'lazy', onerror: (e) => e.target.replaceWith(h('div', { class: 'sg-pic sg-pic-none' })) })); });
  return box;
}

/**
 * Подпись движения для журнала и истории: «Выдано под 552-2 · название», «Возврат с 552-2», «Списано: причина».
 * Название позиции заказа подгружается по заказу (один запрос на заказ); без позиции — только то, что есть в записи.
 * Возвращает элемент или null (подписывать нечего — старые записи как раньше).
 */
export function targetNote(m) {
  if (m.reason && !m.isReturn) return h('span', { class: 'tn tn-reason' }, `Списано: ${m.reason}`);
  if (!m.salesOrderLineId || !m.salesOrderId) return m.isReturn ? h('span', { class: 'tn' }, 'Возврат со сборки') : null;
  const verb = m.isReturn ? 'Возврат с' : 'Выдано под';
  const el = h('span', { class: 'tn' }, m.isReturn ? 'Возврат со сборки…' : 'Выдано под позицию заказа…');
  orderLines(m.salesOrderId).then((ls) => {
    const l = ls.find((x) => x.id === m.salesOrderLineId);
    if (!l) { el.textContent = m.isReturn ? 'Возврат со сборки' : 'Выдано под позицию заказа'; return; }
    el.textContent = m.isReturn ? `${verb} ${lineCode(l)}` : `${verb} ${lineCode(l)} · ${l.title}`;
    el.title = `${verb} ${lineCode(l)} · ${l.title}`;
  }).catch(() => { el.textContent = m.isReturn ? 'Возврат со сборки' : 'Выдано под позицию заказа'; });
  return el;
}
/** Короткая подпись без запросов (карточки на телефоне, строки поиска). */
export const targetShort = (m) => (m.reason && !m.isReturn ? `Списано: ${m.reason}` : m.isReturn ? 'Возврат со сборки' : m.salesOrderLineId ? 'Выдано под позицию заказа' : '');

export function targetPicker({ mode = 'out' } = {}) {
  const ret = mode === 'return';
  let kind = ret ? 'order' : 'free';
  let orders = null; let loadingOrders = false;
  let order = null; // { id, label, orderNo }
  let lines = null; let linesErr = ''; // позиции выбранного заказа
  let line = null; // выбранная позиция; whole — весь заказ
  let whole = false;
  let q = '';

  const el = h('div', { class: 'tp wide' });

  // ---------- переключатель ----------
  const KINDS = [['order', 'Под заказ'], ['person', 'Сотруднику'], ['free', 'Просто выдано']];
  const seg = ret ? null : h('div', { class: 'fseg', role: 'radiogroup', 'aria-label': 'Кому / под что выдаём' },
    ...KINDS.map(([k, label]) => h('button', { type: 'button', role: 'radio', class: 'fseg-btn', 'data-k': k, onclick: () => setKind(k) }, label)));
  function setKind(k) {
    kind = k;
    seg?.querySelectorAll('.fseg-btn').forEach((b) => { const on = b.dataset.k === k; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); });
    orderPanel.hidden = k !== 'order'; personPanel.hidden = k !== 'person'; freePanel.hidden = k !== 'free';
  }

  // ---------- заказ → позиция ----------
  const orderBox = h('div', { class: 'tp-order' });
  const orderPanel = h('div', { class: 'tp-panel' }, orderBox);
  const orderIn = h('input', { placeholder: 'Номер заказа или заказчик, например 552 · 552-2', 'aria-label': 'Заказ', autocomplete: 'off' });
  const orderOpts = () => (orders || []).map((o) => ({ value: o.id, label: orderLabel(o), sub: o.title || '' }));
  const dash = (text) => { const m = /^\s*(\S+?)\s*[-–]\s*(\d+)\s*$/.exec(text); return m ? { no: normSearch(m[1]), line: m[2] } : null; };
  const orderCombo = attachCombo(orderIn, {
    options: orderOpts,
    empty: () => (loadingOrders ? 'Загружаю заказы…' : ''),
    onPick: (o) => { const x = orders.find((r) => r.id === o.value); orderIn.value = ''; if (x) chooseOrder(x); },
    // «552-2» — заказ и позиция сразу
    extra: (text) => {
      const d = orders && dash(text); if (!d) return [];
      const o = orders.find((r) => normSearch(r.orderNo) === d.no); if (!o) return [];
      return [{ label: `№ ${o.orderNo} → позиция ${d.line}`, run: () => { orderIn.value = ''; chooseOrder(o, d.line); } }];
    },
  });
  orderIn.addEventListener('focus', async () => {
    if (orders || loadingOrders) return;
    loadingOrders = true;
    try { orders = await activeOrders(); } catch { orders = []; } finally { loadingOrders = false; }
    if (document.activeElement === orderIn) orderCombo.refresh();
  });

  let wantLineNo = null;
  async function chooseOrder(o, lineNo) {
    order = { id: o.id, label: orderLabel(o), orderNo: o.orderNo }; lines = null; linesErr = ''; line = null; whole = false; q = ''; wantLineNo = lineNo || null;
    renderOrder();
    try {
      lines = await orderLines(o.id);
      if (wantLineNo) { const l = lines.find((x) => String(x.lineNo) === String(wantLineNo)); if (l) line = l; }
    } catch (e) { linesErr = errText(e); }
    if (order?.id === o.id) renderOrder();
  }

  function renderOrder() {
    if (!order) { orderBox.replaceChildren(h('label', { class: 'field wide' }, h('span', null, ret ? 'Заказ, из которого вернули' : 'Заказ'), orderIn)); return; }
    const head = h('div', { class: 'tp-sel' }, h('b', { class: 'clip' }, order.label),
      h('button', { type: 'button', class: 'btn btn-sm', onclick: () => { order = null; lines = null; line = null; whole = false; renderOrder(); requestAnimationFrame(() => orderIn.focus()); } }, 'Сменить заказ'));
    if (linesErr) { orderBox.replaceChildren(head, h('p', { class: 'muted' }, 'Позиции не загрузились: ' + linesErr)); return; }
    if (!lines) { orderBox.replaceChildren(head, h('div', { class: 'skel', style: { width: '60%', margin: 'var(--s2) 0' } })); return; }
    if (line || whole) {
      orderBox.replaceChildren(head, h('div', { class: 'pp-prod-sel tp-line-sel' },
        line ? picBox(line) : null,
        h('div', { style: { flex: '1', minWidth: 0 } }, h('b', null, line ? `${lineCode(line)} · ${line.title}` : 'Весь заказ'), line?.qty ? h('div', { class: 'muted' }, `в заказе ${qty(line.qty)}`) : h('div', { class: 'muted' }, 'без конкретной позиции')),
        h('button', { type: 'button', class: 'btn btn-sm', onclick: () => { line = null; whole = false; renderOrder(); } }, 'Сменить')));
      return;
    }
    const input = h('input', { value: q, placeholder: 'Найти позицию: 552-2 или название', 'aria-label': 'Найти позицию заказа', autocomplete: 'off' });
    const list = h('ul', { class: 'pp-prod-list', role: 'listbox', 'aria-label': 'Позиции заказа' });
    const pick = (l) => { line = l; whole = !l; renderOrder(); };
    const fill = () => {
      const tk = searchTokens(q);
      const rows = lines.filter((l) => !tk.length || tk.every((t) => normSearch(`${lineCode(l)} ${l.title}`).includes(t)));
      const items = rows.map((l) => h('li', { class: 'sg-row sg-pic-row', role: 'option', tabindex: '0', onclick: () => pick(l), onkeydown: (e) => { if (e.key === 'Enter') pick(l); } },
        picBox(l), h('div', null, h('div', { class: 'opt-l' }, `${lineCode(l)} · ${l.title}`), l.qty ? h('small', null, `в заказе ${qty(l.qty)}`) : null)));
      if (!ret && !tk.length) items.push(h('li', { class: 'sg-row', role: 'option', tabindex: '0', onclick: () => pick(null), onkeydown: (e) => { if (e.key === 'Enter') pick(null); } }, h('div', { class: 'opt-l' }, 'Весь заказ'), h('small', null, 'без конкретной позиции')));
      list.replaceChildren(...(items.length ? items : [h('li', { class: 'sg-row static' }, h('span', { class: 'muted' }, lines.length ? `По «${q}» позиций нет` : 'В заказе нет позиций — выберите «Весь заказ» или добавьте позицию в заказе'))]));
    };
    let t; input.addEventListener('input', () => { q = input.value; clearTimeout(t); t = setTimeout(fill, 120); });
    fill();
    orderBox.replaceChildren(head, h('div', { class: 'pp-prod-tools' }, input), list);
  }
  renderOrder();

  // ---------- сотрудник ----------
  const personSel = h('select', { 'aria-label': 'Сотрудник' }, h('option', { value: '' }, '— сотрудник —'));
  let peopleLoaded = false;
  const loadPeople = () => {
    if (peopleLoaded) return; peopleLoaded = true;
    peopleByWork().then((groups) => {
      if (!groups.length) { personSel.firstChild.textContent = '— сотрудников нет в «Справочниках» —'; return; }
      for (const g of groups) personSel.append(h('optgroup', { label: g.group }, ...g.people.map((p) => h('option', { value: p.id }, p.name))));
      enhanceSelect(personSel, { force: true });
    }).catch(() => { peopleLoaded = false; personSel.firstChild.textContent = '— список не загрузился —'; });
  };
  const personPanel = h('div', { class: 'tp-panel' }, h('label', { class: 'field wide' }, h('span', null, 'Сотрудник'), personSel));

  // ---------- просто выдано ----------
  const freeIn = h('input', { maxlength: 200, placeholder: 'Объект, бригада, заказ — из списка или своё (необязательно)', 'aria-label': 'Куда / кому выдано' });
  withOrders(freeIn);
  const freePanel = h('div', { class: 'tp-panel' }, h('label', { class: 'field wide' }, h('span', null, 'Куда выдано'), freeIn));

  if (seg) {
    el.append(h('div', { class: 'field wide' }, h('span', { class: 'tp-label' }, 'Кому / под что'), seg), orderPanel, personPanel, freePanel);
    seg.addEventListener('click', () => { if (kind === 'person') loadPeople(); });
    setKind('free');
  } else {
    el.append(orderPanel);
  }
  // сотрудник «под заказ» не прячем: человек получил материал под позицию — это два разных сведения
  const personWithOrder = ret ? null : h('label', { class: 'field wide tp-who' }, h('span', null, 'Получил сотрудник (необязательно)'));
  let personSel2 = null;
  if (personWithOrder) {
    personSel2 = h('select', { 'aria-label': 'Получил сотрудник' }, h('option', { value: '' }, '— не указан —'));
    personWithOrder.append(personSel2);
    orderPanel.append(personWithOrder);
    let loaded = false;
    const fillPeople = () => {
      if (loaded) return; loaded = true;
      peopleByWork().then((groups) => { for (const g of groups) personSel2.append(h('optgroup', { label: g.group }, ...g.people.map((p) => h('option', { value: p.id }, p.name)))); enhanceSelect(personSel2, { force: true }); }).catch(() => { loaded = false; });
    };
    seg.addEventListener('click', () => { if (kind === 'order') fillPeople(); });
  }

  return {
    el,
    kind: () => kind,
    orderId: () => (kind === 'order' && order ? order.id : ''),
    orderLabel: () => (kind === 'order' && order ? order.label : ''),
    /** Выбранная позиция заказа (для подтверждений). */
    line: () => (kind === 'order' ? line : null),
    check: () => {
      if (kind !== 'order') return kind === 'person' && !personSel.value ? 'Выберите сотрудника или переключите на «Просто выдано»' : '';
      if (!order) return ret ? 'Выберите заказ, из которого вернули' : 'Выберите заказ или переключите на «Просто выдано»';
      if (!lines && !linesErr) return 'Позиции заказа ещё загружаются — подождите секунду';
      if (ret && !line) return 'Выберите позицию заказа, с которой вернули';
      if (!line && !whole && lines?.length) return 'Выберите позицию заказа или «Весь заказ»';
      return '';
    },
    value: () => {
      if (kind === 'order' && order) return { salesOrderId: order.id, ...(line ? { salesOrderLineId: line.id } : {}), ...(personSel2?.value ? { personId: personSel2.value } : {}) };
      if (kind === 'person' && personSel.value) return { personId: personSel.value };
      if (kind === 'free' && freeIn.value.trim()) return { issuedTo: freeIn.value.trim() };
      return {};
    },
    dirty: () => !!(order || personSel.value || freeIn.value.trim()),
    reset: () => { order = null; lines = null; line = null; whole = false; personSel.value = ''; if (personSel2) personSel2.value = ''; freeIn.value = ''; renderOrder(); },
  };
}
