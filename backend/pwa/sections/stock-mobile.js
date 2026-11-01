import { api, session } from '../core/api.js';
import { h } from '../core/dom.js';
import { qty as fmt } from '../core/format.js';
import { normSearch, searchTokens } from '../core/facets.js';
import { mobile, errText } from '../ui/kit/index.js';
import { activeOrders, orderLabel } from './salesorders.js';
import { peopleByWork } from './issue.js';

/*
 * «Склад (телефон)» — одна страница ассистента кладовщика (P11): «Принять на склад» и «Выдать со склада».
 * Собрана только из эталонов kit «mobile»; операции — те же вызовы, что у склада (POST /stock/batch, POST /supply/requests/:id/receive).
 * Точка расширения QR: scanButton(onItem) — когда появится сканер, вернуть кнопку «Сканировать» (сейчас null, заглушек нет).
 */
const { screen, bigButton, choice, qty, search, done, error } = mobile;
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random());
const scanButton = (_onItem) => null;
const MANY = 7; // длиннее — над списком появляется поиск

const itemOpt = (it) => ({ value: it, label: it.name, hint: `На складе: ${fmt(it.quantity)} ${it.unit || ''}${it.article ? ' · ' + it.article : ''}` });
const itemSearch = (onPick) => search({ placeholder: 'Название или артикул', extra: scanButton(onPick), onPick: (o) => onPick(o.value), empty: 'Такой позиции нет на складе',
  source: async (q) => ((await api('/stock/items', { query: { search: q, limit: 20, sort: 'name' } })).items || []).map(itemOpt) });

/** Список или (если длинный) поиск по готовому списку. */
function pickFrom(items, onPick, placeholder, empty) {
  if (items.length <= MANY) return choice({ items, onPick, empty });
  return search({ placeholder, onPick, empty, source: async (q) => { const tk = searchTokens(q); return items.filter((o) => tk.every((t) => normSearch(o.label + ' ' + (o.hint || '')).includes(t))).slice(0, 20); } });
}

export const stockMobile = {
  title: 'Склад',
  mount(el) {
    const show = (node) => { el.replaceChildren(node); window.scrollTo(0, 0); };
    const offline = (e) => !e?.status;
    const failed = (e, retry) => error(offline(e) ? 'Нет связи. Ничего не потеряно — повторите, когда появится связь.' : (errText(e) || 'Не получилось. Попробуйте ещё раз.'), { onRetry: retry });

    const home = () => show(screen({ title: 'Что делаем?', body: [
      bigButton({ label: 'Выдать со склада', tone: 'neutral', onClick: () => issue() }),
      bigButton({ label: 'Выйти', tone: 'ghost', onClick: () => { session.clear(); window.location.reload(); } }),
    ], foot: bigButton({ label: 'Принять на склад', onClick: () => receive() }) }));

    // ---------- Выдача: позиция → сколько → на что → подтвердить ----------
    function issue() {
      const S = {};
      const stepItem = () => show(screen({ title: 'Что выдаём?', step: { n: 1, of: 4 }, back: home, body: [itemSearch((it) => { S.item = it; stepQty(); })], footHint: 'Выберите позицию' }));
      const stepQty = () => {
        const q = qty({ value: 1, unit: S.item.unit || 'шт', max: fmt(S.item.quantity) });
        const msg = h('div');
        show(screen({ title: `Сколько выдать? ${S.item.name}`, step: { n: 2, of: 4 }, back: stepItem, body: [q.el, msg],
          footHint: 'Впишите количество', foot: bigButton({ label: 'Дальше', onClick: () => {
            const n = q.value();
            if (!(n > 0)) { msg.replaceChildren(error('Впишите количество больше нуля.')); return; }
            if (n > S.item.quantity) { msg.replaceChildren(error(`На складе только ${fmt(S.item.quantity)} ${S.item.unit || ''}.`)); return; }
            S.qty = n; stepKind();
          } }) }));
      };
      const stepKind = () => show(screen({ title: 'На что выдаём?', step: { n: 3, of: 4 }, back: stepQty, footHint: 'Выберите, на что',
        body: [choice({ items: [{ value: 'order', label: 'На заказ' }, { value: 'person', label: 'На производство' }], onPick: (o) => (o.value === 'order' ? stepOrder() : stepPerson()) })] }));
      const stepOrder = async () => {
        const box = h('div', null, h('div', { class: 'm-empty' }, 'Загружаю заказы…'));
        show(screen({ title: 'На какой заказ?', step: { n: 3, of: 4 }, back: stepKind, body: [box] }));
        try {
          const items = (await activeOrders()).map((o) => ({ value: o.id, label: orderLabel(o), hint: o.title || '' }));
          box.replaceChildren(pickFrom(items, (o) => { S.target = { salesOrderId: o.value }; S.where = `на заказ ${o.label}`; stepSure(); }, 'Номер заказа или заказчик', 'Заказов в работе нет'));
        } catch (e) { box.replaceChildren(failed(e, stepOrder)); }
      };
      const stepPerson = async () => {
        const box = h('div', null, h('div', { class: 'm-empty' }, 'Загружаю список…'));
        show(screen({ title: 'Кому выдать?', step: { n: 3, of: 4 }, back: stepKind, body: [box] }));
        try {
          const items = (await peopleByWork()).flatMap((g) => g.people.map((p) => ({ value: p.id, label: p.name, hint: g.group })));
          box.replaceChildren(pickFrom(items, (o) => { S.target = { personId: o.value }; S.where = `на производство, ${o.label}`; stepSure(); }, 'Фамилия', 'Сотрудников нет в справочнике'));
        } catch (e) { box.replaceChildren(failed(e, stepPerson)); }
      };
      const stepSure = () => {
        const clientUid = uid(); // повтор после сбоя связи не задвоит выдачу
        const msg = h('div');
        const line = `${S.item.name} · ${fmt(S.qty)} ${S.item.unit || ''} · ${S.where}`;
        show(screen({ title: 'Всё верно?', step: { n: 4, of: 4 }, back: stepKind, body: [h('p', null, line), msg],
          foot: bigButton({ label: 'Выдать', onClick: async () => {
            msg.replaceChildren();
            try {
              await api('/stock/batch', { method: 'POST', body: { type: 'out', lines: [{ materialId: S.item.id, qty: S.qty }], clientUid, ...S.target } });
              show(screen({ title: 'Готово', body: [done({ text: `Выдано: ${line}`, again: { label: 'Ещё выдать', onClick: issue }, home: { label: 'На главный экран', onClick: home } })] }));
            } catch (e) { msg.replaceChildren(failed(e)); }
          } }) }));
      };
      stepItem();
    }

    // ---------- Приёмка: позиция → (поставка) → сколько → подтвердить ----------
    function receive() {
      const S = {};
      const stepItem = () => show(screen({ title: 'Что принимаем?', step: { n: 1, of: 3 }, back: home, footHint: 'Выберите позицию', body: [itemSearch(async (it) => { S.item = it; S.req = null; await stepFrom(); })] }));
      const stepFrom = async () => {
        let reqs = [];
        try { reqs = ((await api('/supply/requests', { query: { status: 'ordered,paid', limit: 100, sort: '-requestDate' } })).items || []).filter((r) => r.materialId === S.item.id); }
        catch (e) { show(screen({ title: 'Что принимаем?', step: { n: 1, of: 3 }, back: stepItem, body: [failed(e, stepFrom)] })); return; }
        if (!reqs.length) { stepQty(); return; }
        const items = reqs.map((r) => ({ value: r, label: `${fmt(r.qty)} ${r.unit || ''}${r.supplierName ? ' · ' + r.supplierName : ''}`, hint: [r.invoiceNo, r.paid ? 'оплачено' : ''].filter(Boolean).join(' · ') }));
        items.push({ value: null, label: 'Без поставки', hint: 'Принять просто так, без заявки' });
        show(screen({ title: 'Это по какой поставке?', step: { n: 2, of: 3 }, back: stepItem, body: [choice({ items, onPick: (o) => { S.req = o.value; stepQty(); } })] }));
      };
      const stepQty = () => {
        const q = qty({ value: S.req ? S.req.qty : 1, unit: S.item.unit || 'шт', max: fmt(S.item.quantity) });
        const msg = h('div');
        show(screen({ title: `Сколько принять? ${S.item.name}`, step: { n: 3, of: 3 }, back: stepItem, body: [q.el, msg],
          footHint: 'Впишите количество', foot: bigButton({ label: 'Принять', onClick: async () => {
            const n = q.value();
            if (!(n > 0)) { msg.replaceChildren(error('Впишите количество больше нуля.')); return; }
            msg.replaceChildren();
            const line = `${S.item.name} · ${fmt(n)} ${S.item.unit || ''}`;
            try {
              if (S.req) await api(`/supply/requests/${S.req.id}/receive`, { method: 'POST', body: { qty: n, partial: n < S.req.qty } });
              else await api('/stock/batch', { method: 'POST', body: { type: 'in', lines: [{ materialId: S.item.id, qty: n }], clientUid: uid() } });
              show(screen({ title: 'Готово', body: [done({ text: `Принято: ${line}`, again: { label: 'Ещё принять', onClick: receive }, home: { label: 'На главный экран', onClick: home } })] }));
            } catch (e) { msg.replaceChildren(failed(e)); }
          } }) }));
      };
      stepItem();
    }

    home();
    return { destroy() { /* состояние живёт в замыканиях экрана */ } };
  },
};
