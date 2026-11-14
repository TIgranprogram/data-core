import { api } from '../../../core/api.js';
import { h } from '../../../core/dom.js';
import { ordersLookup } from '../../../core/orders-lookup.js';
import { button, enhanceSelect, field, hint, link, select, sideNote, stack, table, toast, toastError } from '../../../ui/kit/index.js';
import { lastFirm, ourCompanies, rememberFirm } from '../common.js';
import { printDialog } from '../dialogs.js';
import { issueFromProduct } from './api.js';

/**
 * Шаг 7 «Выпуск»: номер и дата ставятся сами; «Заполнить после печати» свёрнуто и выпуск не держит;
 * C112 Ф1: кнопка «Выпустить» живёт в закреплённой полосе панели (funnel/index.js), здесь — run() и status().
 * После выпуска открывается окно PDF и печати (то же, что в архиве паспортов).
 * Фирма — список наших компаний; из заказа предвыбор companyId (можно сменить). Без позиции — список позиций.
 *   issueBlock({ prod, order?, goGaps(), onIssued(passport) }) → { el, paint(missingRequired[]), run(btn), status() → { ready, why, need: [{label}] } }
 *   order: { salesOrderId?, incomeId?, orderNo?, customerName?, noOrder? } — incomeId уже выбран, список позиций не нужен.
 *   noOrder — шаг «Без заказа»: фирма «как в прошлый раз» у этого менеджера (localStorage).
 */
const lineName = (l, i) => `поз. ${l.seqNo ?? l.lineNo ?? i + 1} · ${l.title || l.productName || 'позиция'}`;
const locked = (e) => e?.status === 409;

/** Открытые позиции этого изделия (заказы в работе). Один пункт — одно нажатие. */
export async function openPositions(productId) {
  const orders = await ordersLookup({ filter: 'active', lines: true }).catch(() => []);
  const pid = String(productId);
  const out = [];
  for (const o of orders || []) {
    const no = o.productionNo || o.orderNo || '';
    const orderText = [no ? '№ ' + no : 'Без номера', o.customer].filter(Boolean).join(' · ');
    for (const l of o.lines || []) {
      if (String(l.productId || '') !== pid) continue;
      const seq = l.seqNo ?? l.lineNo;
      out.push({
        incomeId: String(l.id), salesOrderId: String(o.id),
        orderNo: o.orderNo || o.productionNo || '', customerName: o.customer || '', orderText,
        meta: [seq != null ? 'поз. ' + seq : '', l.title || 'позиция'].filter(Boolean).join(' · '),
      });
    }
  }
  return out;
}

/** Шаг «Для заказа»: список позиций и «Без заказа». */
export function orderStep({ positions, onPick, onNone }) {
  return stack(
    hint('Открытые позиции с этим изделием. Одно нажатие подставит заказчика, номер, адрес и фирму.'),
    button({ label: 'Без заказа', kind: 'ghost', title: 'Паспорт без привязки к заказу', onClick: onNone }),
    table({
      label: 'Для заказа', clickable: true, maxHeight: 'M',
      columns: [{ label: 'Заказ' }],
      rows: positions.map((p) => ({
        onClick: () => onPick(p), data: p.incomeId,
        cells: [h('div', null, h('div', { title: p.orderText }, p.orderText), h('small', { class: 'muted' }, p.meta))],
      })),
    }),
  );
}

export function issueBlock({ prod, order, goGaps, onIssued, onState }) {
  const box = h('div', null);
  const needLine = !!(order?.salesOrderId && !order.incomeId);
  let miss = [];
  let listsReady = false;
  let firms = [];
  let lines = [];
  let firmId = '';
  let lineId = order?.incomeId ? String(order.incomeId) : '';
  let orderDoc = null;
  let lineErr = false;
  let mismatch = false;
  let objectName = '';
  let addressState = 'none'; // none — у заказа нет объекта; value — есть; unknown — КП не прочиталось, сервер допишет сам
  let fromMemory = false;
  let orderFirmId = '';
  let orderFirmName = '';
  const forOrder = !!(order?.salesOrderId || order?.incomeId) && !order?.noOrder;
  let running = false;
  let state = { ready: false, why: 'Загружаю фирмы…', need: [] };

  const fromOrderNote = () => {
    if (!forOrder) return null;
    const who = order?.customerName || orderDoc?.customer;
    const no = orderDoc?.productionNo || order?.orderNo || orderDoc?.orderNo; // как в очереди: «2-26», а не внутренний № 14
    const bits = [who, no ? '№ ' + no : '', objectName].filter(Boolean);
    if (!bits.length && addressState !== 'unknown') return null;
    const tail = addressState === 'value' ? '' : addressState === 'unknown' ? '. Адрес возьмётся из объекта КП, если он указан' : '. Адреса в заказе нет — можно вписать после печати';
    return sideNote('Из заказа: ' + (bits.join(' · ') || 'позиция') + tail);
  };
  const laterNote = () => {
    if (!forOrder) return 'Покупателя, заказ, адрес, монтаж и дату продажи можно вписать позже в карточке выпущенного паспорта — выпуск они не держат.';
    if (addressState === 'value') return 'Покупатель, номер и адрес уже из заказа. Монтаж и дату продажи можно вписать позже.';
    if (addressState === 'unknown') return 'Покупатель и номер уже из заказа. Адрес подставится из объекта КП, если он есть. Монтаж и дату продажи — позже.';
    return 'Покупатель и номер уже из заказа. Адрес, монтаж и дату продажи можно вписать позже.';
  };

  /** Выпустить: вызывает полоса панели (Ф1); btn — её кнопка (занята на время запроса). */
  async function run(b) {
    if (!state.ready || running) return;
    running = true;
    if (b) { b.classList.add('is-busy'); b.disabled = true; }
    try {
      const res = await issueFromProduct(prod.id, {
        supplierOrgId: firmId,
        incomeId: forOrder ? (order?.incomeId || lineId || undefined) : undefined,
        salesOrderId: forOrder ? order?.salesOrderId : undefined,
        orderNo: forOrder ? (order?.orderNo || orderDoc?.orderNo || orderDoc?.productionNo) : undefined,
        customerName: forOrder ? (order?.customerName || orderDoc?.customer) : undefined,
        objectName: forOrder ? (objectName || undefined) : undefined,
      });
      if (res.missing) { toast('Для выпуска не хватает: ' + res.missing.join(', '), { error: true }); return; }
      rememberFirm(firmId);
      toast(`Выпущен паспорт № ${res.passport.passportNumber}`);
      window.dispatchEvent(new CustomEvent('data-changed'));
      onIssued?.(res.passport);
      printDialog(res.passport);
    } catch (err) {
      if (locked(err)) toast(/[а-яё]/i.test(err.message || '') ? err.message : 'На эту позицию заказа паспорт уже есть. Откройте его и нажмите «Печать».', { error: true });
      else toastError(err, 'выпустить паспорт');
    } finally { running = false; if (b) { b.classList.remove('is-busy'); b.disabled = !state.ready; } }
  }

  const firmHint = () => {
    if (orderFirmName && firmId === orderFirmId) return `Заказ на ${orderFirmName}. Выпустить на другую фирму — выберите здесь, номер не изменится.`;
    if (fromMemory) return 'Фирма — как в прошлый раз. Можно выбрать другую.';
    return 'Номер от выбора фирмы не меняется.';
  };

  function paint(missing = miss) {
    miss = missing;
    if (!listsReady) { box.replaceChildren(hint('Загружаю фирмы…')); return; }
    const gaps = !miss.length;
    const firmOk = !!firmId;
    const lineOk = !needLine || !!lineId;
    const ready = gaps && firmOk && lineOk;
    const why = !firmOk ? 'Выберите фирму' : !lineOk ? 'Выберите позицию заказа' : 'Сначала заполните недостающее';
    state = { ready, why: ready ? 'Присвоить номер и талон, затем скачать или распечатать' : why, need: [...(firmOk ? [] : [{ label: 'фирма' }]), ...(lineOk ? [] : [{ label: 'позиция заказа' }])] };
    onState?.(state);
    const firmOpts = firms.length > 1 ? [['', 'Выберите фирму'], ...firms.map((o) => [o.id, o.name])] : firms.map((o) => [o.id, o.name]);
    const firmSel = firms.length ? select({ label: 'Фирма', value: firmId, options: firmOpts, onChange: (v) => { firmId = v; fromMemory = false; if (v) rememberFirm(v); paint(miss); } }) : null;
    const lineOpts = needLine && lines.length > 1 ? [['', 'Выберите позицию'], ...lines.map((l, i) => [l.id, lineName(l, i)])] : lines.map((l, i) => [l.id, lineName(l, i)]);
    const lineSel = needLine && lines.length ? select({ label: 'Позиция заказа', value: lineId, options: lineOpts, onChange: (v) => { lineId = v; paint(miss); } }) : null;
    box.replaceChildren(...[
      sideNote('Номер, гарантийный талон и дату система поставит сама при выпуске.'),
      fromOrderNote(),
      firmSel ? field('Фирма', firmSel, { hint: firmHint() }) : hint('Нет наших фирм. Добавьте компанию в контрагентах.', 'warn'),
      order?.incomeId ? hint('Позиция заказа уже выбрана. Новый номер на неё не создастся, если паспорт уже есть.') : null,
      lineSel ? field('Позиция заказа', lineSel) : null,
      needLine && lineErr ? hint('Не удалось загрузить позиции заказа.', 'warn') : null,
      needLine && !lineErr && !lines.length ? hint('В заказе нет позиций. Паспорт к позиции не привязать.', 'warn') : null,
      mismatch ? hint('В заказе нет позиции этого изделия. Выберите позицию, к которой отнести паспорт.') : null,
      gaps ? null : sideNote('Не хватает для выпуска: ',
        ...miss.flatMap((m, i) => [i ? ', ' : null, link({ label: m.label, onClick: () => goGaps?.() })])),
      sideNote(laterNote()),
    ].filter(Boolean));
    if (firmSel) enhanceSelect(firmSel);
    if (lineSel) enhanceSelect(lineSel);
  }

  (async () => {
    try { firms = (await ourCompanies()).map((o) => ({ id: String(o.id), name: o.name || 'Фирма' })); } catch { firms = []; }
    // заказ нужен и для позиций, и для предвыбора фирмы (companyId заказа — C063)
    if (forOrder && order?.salesOrderId) {
      try {
        orderDoc = await api(`/salesorders/${order.salesOrderId}`);
        if (orderDoc?.offerId) {
          try {
            objectName = String((await api(`/offers/${orderDoc.offerId}`))?.objectName || '').trim();
            addressState = objectName ? 'value' : 'none';
          } catch { addressState = 'unknown'; }
        }
        if (needLine) {
          const all = (orderDoc.lines || []).filter((l) => !l.cancelledAt && l.status !== 'cancelled').map((l, i) => ({ ...l, id: String(l.id || l._id), _i: i }));
          const mine = all.filter((l) => String(l.productId || '') === String(prod.id));
          mismatch = !mine.length && all.length > 0;
          lines = mine.length ? mine : all;
          if (lines.length === 1) lineId = lines[0].id;
        }
      } catch { if (needLine) { lineErr = true; lines = []; } addressState = 'unknown'; }
    }
    const orderFirm = String(orderDoc?.companyId || orderDoc?.company?.id || '');
    const remembered = lastFirm();
    if (orderFirm && firms.some((f) => f.id === orderFirm)) { firmId = orderFirm; orderFirmId = orderFirm; orderFirmName = firms.find((f) => f.id === orderFirm).name; }
    else if (firms.length === 1) firmId = firms[0].id;
    else if (remembered && firms.some((f) => f.id === remembered)) firmId = remembered;
    fromMemory = firms.length > 1 && !!firmId && firmId === remembered && firmId !== orderFirm;
    listsReady = true;
    paint(miss);
  })();
  return { el: box, paint, run, status: () => state };
}
