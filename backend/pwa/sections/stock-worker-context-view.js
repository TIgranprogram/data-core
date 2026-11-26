import { h } from '../core/dom.js';
import { date, parseNum, qty } from '../core/format.js';
import { actions, badge, busyBlock, button, card, clamp, failBlock, modal, scroll, stack, table, textInput } from '../ui/kit/index.js';
import { contextCancelled } from './stock-worker-context.js';
import { workerInputQuantity, workerLength, workerPieceFactor, workerPipeMetres, workerPipePieces } from './stock-worker-model.js';

const statuses = {
  requested: ['Заказать', 'warn'], in_progress: ['В работе', 'info'],
  ordered: ['Заказано', 'info'], paid: ['Оплачено', 'ok'],
};
const amount = row => [qty(row.qty), row.unit].filter(Boolean).join(' ');

function requestsTable(items) {
  if (!items.length) return h('p', { class: 'hint' }, 'Открытых заявок нет.');
  return table({
    label: 'Открытые заявки',
    columns: [{ label: 'Заявка и поставщик', wrap: true }, { label: 'Остаток' }, { label: 'Срок поставки', wrap: true }],
    rows: items.map(row => {
      const [label, tone] = statuses[row.status] || ['Статус не указан', 'dim'];
      const details = [row.supplierName, row.invoiceNo ? 'Счёт № ' + row.invoiceNo : null].filter(Boolean);
      return { cells: [
        h('div', null, clamp(h('span', null, h('strong', null, row.num ? 'Заявка № ' + row.num : 'Заявка'), ' ', badge(row.statusLabel || label, tone)), { lines: 2 }),
          details.length ? clamp(h('small', null, details.join(' · ')), { lines: 2 }) : null),
        h('strong', null, amount(row)),
        row.invoiceDeliveryDate ? date(row.invoiceDeliveryDate) : clamp('Дата поставки не указана', { lines: 2 }),
      ] };
    }),
  });
}

function reservationCards(items) {
  if (!items.length) return h('p', { class: 'hint' }, 'Активных броней нет.');
  return stack(...items.map(row => card({
    size: 'S', compact: true, title: row.groupName || row.orderId || 'Назначение не указано',
    meta: h('span', null, h('strong', null, amount(row)), ' · ', row.salesOrder || 'Без заказа'),
    badges: row.hanging ? badge(row.hanging, 'warn') : null,
  })));
}

/** Эталоны таблицы, компактной карточки и подтверждения с одним полем. */
export function workerContextView(material, item, { readOnly, current }) {
  const requestBox = h('div', { 'data-worker-requests': '1' });
  const reservationBox = h('div', { 'data-worker-reservations': '1' });
  const resultBox = h('div', { role: 'status', hidden: true });
  const action = button({ label: 'Заказать', onClick: () => { void openOrder(); } });
  const unit = item.unit?.trim();
  const pipe = item.metal === 'pipe', supported = !pipe || workerPieceFactor(item) != null;
  let requests, shownRequests, shownReservations, orderOpen = false, orderError = null, pending = false, observedOrder;

  function paintOrder() {
    const { pendingQty, saving, result } = material.orderState;
    action.textContent = saving ? 'Отправляю…' : pendingQty == null ? 'Заказать' : 'Повторить отправку заявки';
    action.classList.toggle('is-busy', saving);
    action.setAttribute('aria-busy', String(saving));
    action.disabled = !requests || requests.more || !unit || (!supported && pendingQty == null) || orderOpen || saving;
    resultBox.replaceChildren(
      result ? h('p', { class: 'hint' }, 'Создана заявка № ' + (result.num || result.id)) : null,
      orderError ? failBlock(orderError, null, { text: pendingQty == null ? 'Заявка не создана' : 'Создание заявки не подтверждено' }) : null,
      !readOnly && !unit ? h('p', { class: 'hint' }, 'Для заявки нужна единица учёта материала.') : null,
      !readOnly && unit && !supported && pendingQty == null ? h('p', { class: 'hint' }, 'Для заказа труб нужна единица «шт» или «м» с указанной длиной.') : null,
      !readOnly && requests?.more ? h('p', { class: 'hint' }, 'Для новой заявки сначала загрузите все открытые заявки.') : null,
    );
    resultBox.hidden = !resultBox.childElementCount;
  }
  async function openOrder() {
    if (readOnly || action.disabled || !current()) return;
    orderOpen = true; paintOrder();
    try {
      const { pendingQty } = material.orderState;
      const retry = pendingQty != null, additional = requests.items.length > 0;
      const retryPieces = retry && pipe ? workerPipePieces({ ...item, quantity: pendingQty }) : null;
      const pieces = pipe && supported && (!retry || retryPieces != null);
      const conversion = h('small', { class: 'hint', hidden: true });
      const updateConversion = () => {
        let metres = null;
        try {
          if (pieces) metres = workerPipeMetres({ ...item, quantity: retry ? pendingQty : workerInputQuantity(item, field.value, 'pipe') });
        } catch { /* Подтверждение покажет ошибку ввода. */ }
        conversion.textContent = metres == null ? '' : `${field.value} шт × ${qty(workerLength(item) / 1000)} м = ${qty(metres)} м`;
        conversion.hidden = metres == null;
      };
      const field = textInput({ label: pieces ? 'Количество труб, шт' : 'Количество, ' + unit, inputmode: pieces ? 'numeric' : 'decimal',
        value: retry ? String(pieces ? retryPieces : pendingQty) : '', disabled: retry, short: true, onInput: updateConversion,
        onEnter: () => field.input.form?.requestSubmit() });
      updateConversion();
      const quantity = await modal({
        title: retry ? 'Повторить отправку заявки' : additional ? 'Дополнительная заявка' : 'Заказать материал',
        body: stack(h('strong', null, item.name),
          additional && !retry ? h('p', null, 'Новое количество добавится к открытым заявкам ниже.') : null,
          field.el, conversion, scroll(requestsTable(requests.items))),
        okText: retry ? 'Повторить отправку' : 'Создать заявку',
        onOk() {
          const value = retry ? pendingQty : parseNum(field.value);
          if (!Number.isFinite(value) || value <= 0) throw new Error('Введите положительное количество.');
          return !retry && pieces ? workerInputQuantity(item, field.value, 'pipe') : value;
        },
      });
      if (quantity == null || !current()) return;
      orderError = null;
      const saving = material.order(quantity, { readOnly, additional });
      paintOrder();
      await saving;
      shownRequests = null;
      if (current()) await loadRequests();
    } catch (error) {
      orderError = error;
    } finally {
      orderOpen = false;
      if (current()) {
        paintOrder();
        if (!action.disabled && (document.activeElement === document.body || document.activeElement === action)) action.focus({ preventScroll: true });
      }
    }
  }
  function observeOrder() {
    const operation = material.pendingOrder;
    if (orderOpen || !operation || operation === observedOrder) return;
    observedOrder = operation;
    operation.then(() => {
      if (current()) { shownRequests = null; void loadRequests(); }
    }, error => {
      orderError = error;
      if (current()) paintOrder();
    });
  }
  async function loadRequests(options) {
    if (pending) return;
    let resume = false;
    pending = true; requests = null; paintOrder();
    requestBox.replaceChildren(busyBlock('открытые заявки'));
    try {
      const result = await material.requests(options);
      if (!current()) return;
      requests = result;
      shownRequests = result.items;
      requestBox.replaceChildren(requestsTable(result.items));
      if (result.more) requestBox.append(button({ label: 'Ещё заявки', kind: 'ghost', onClick: () => loadRequests({ more: true }) }));
    } catch (error) {
      if (current()) {
        if (contextCancelled(error)) resume = true;
        else requestBox.replaceChildren(stack(shownRequests?.length ? requestsTable(shownRequests) : null,
          failBlock(error, () => loadRequests({ retry: true }), { text: 'Заявки не загрузились' })));
      }
    } finally {
      pending = false;
      if (resume) void loadRequests(options);
      else if (current()) paintOrder();
    }
  }
  async function loadReservations(options) {
    reservationBox.replaceChildren(busyBlock('активные брони'));
    try {
      const result = await material.reservations(options);
      if (!current()) return;
      shownReservations = result.items;
      reservationBox.replaceChildren(reservationCards(result.items));
      if (result.more) reservationBox.append(button({ label: 'Ещё брони', kind: 'ghost', onClick: () => loadReservations({ more: true }) }));
    } catch (error) {
      if (current()) {
        if (contextCancelled(error)) return loadReservations(options);
        reservationBox.replaceChildren(stack(shownReservations?.length ? reservationCards(shownReservations) : null,
          failBlock(error, () => loadReservations({ retry: true }), { text: 'Брони не загрузились' })));
      }
    }
  }

  return {
    el: stack(h('h3', { class: 'pg-worker-category' }, 'Ожидания'), requestBox, readOnly ? null : actions(action), resultBox,
      h('h3', { class: 'pg-worker-category' }, 'Активные брони'), reservationBox),
    paint() { observeOrder(); loadRequests(); loadReservations(); },
  };
}
