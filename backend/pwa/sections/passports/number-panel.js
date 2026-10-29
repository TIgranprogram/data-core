import { api, session } from '../../core/api.js';
import { h } from '../../core/dom.js';
import { patch } from '../../core/router.js';
import { attachCombo } from '../../ui/combo.js';
import { toast } from '../../ui/toast.js';
import { productsAll } from './models.js';
import { ordersLookup } from '../../core/orders-lookup.js';

/** ПН: журнал номеров — полоска «последний / следующий» и правая панель «Записать номер» (паспорт сделан в другой программе). */
export const canJournal = () => session.role === 'admin' || session.role === 'director' || !!session.user?.isOwner;

let after = null;
const copy = async (text) => { try { await navigator.clipboard.writeText(String(text)); toast('Скопировано'); } catch { toast(String(text)); } };

/** Полоска над списком; refresh() — обновить числа после записи. */
export function numbersStrip() {
  const box = h('div', { class: 'pn-strip', 'aria-label': 'Следующие номера' });
  const piece = (label, val) => h('span', { class: 'pn-item' }, h('span', { class: 'pn-lab' }, label),
    val ? h('button', { type: 'button', class: 'pn-num', title: 'Нажмите, чтобы скопировать', 'aria-label': `${label} ${val} — скопировать`, onclick: () => copy(val) }, String(val), h('span', { class: 'pn-copy', 'aria-hidden': 'true' }, '⧉')) : h('span', { class: 'muted' }, '—'));
  const refresh = async () => {
    try {
      const n = await api('/passports/next-numbers');
      box.replaceChildren(piece('Последний паспорт №', n.lastPassportNo), piece('Следующий №', n.nextPassportNo), piece('Талон', n.nextWarrantyCode), piece('Изделие №', n.nextProductCode));
    } catch { box.replaceChildren(); }
  };
  refresh(); window.addEventListener('pn-refresh', refresh);
  return box;
}

export function openNumberPanel(reload) { after = reload; patch({ of: 'passnum', new: '1', open: undefined }); }

async function build() {
  const [all, nx, orders] = await Promise.all([productsAll(), api('/passports/next-numbers'), ordersLookup({ filter: 'all' }).catch(() => [])]);
  const ids = new Map();
  const prod = h('input', { type: 'text', 'aria-label': 'Изделие', placeholder: 'Название или артикул', autocomplete: 'off' });
  attachCombo(prod, { options: () => all.map((p) => { const l = `${p.name}${p.sku ? ' · арт. ' + p.sku : ''}`; ids.set(l, p.id); return { label: l, value: p.id, sub: [p.type, p.group].filter(Boolean).join(' › ') }; }) });
  const dt = h('input', { type: 'date', 'aria-label': 'Дата', value: new Date().toISOString().slice(0, 10) });
  const cust = h('input', { type: 'text', 'aria-label': 'Заказчик', autocomplete: 'off' });
  // заказ уже отгружен мимо приложения — привязать паспорта к нему; заказчик подставится из заказа
  const oids = new Map();
  const ord = h('input', { type: 'text', 'aria-label': 'Заказ', placeholder: '№ заказа или заказчик', autocomplete: 'off' });
  attachCombo(ord, { options: () => orders.map((o) => { const l = `№ ${o.orderNo}${o.customer ? ' · ' + o.customer : ''}`; oids.set(l, o); return { label: l, value: o.id, sub: o.title || '' }; }) });
  ord.addEventListener('change', () => { const o = oids.get(ord.value.trim()); if (o?.customer && !cust.value.trim()) cust.value = o.customer; });
  const qty = h('input', { type: 'number', min: 1, max: 50, value: 1, inputmode: 'numeric', 'aria-label': 'Сколько паспортов' });
  const no = h('input', { type: 'text', inputmode: 'numeric', 'aria-label': 'Номер паспорта', value: nx.nextPassportNo ?? '' });
  const pc = h('input', { type: 'text', inputmode: 'numeric', 'aria-label': 'Номер изделия', value: nx.nextProductCode ?? '' });
  const err = h('div', { class: 'field-err', role: 'alert' });
  const f = (label, el, ...rest) => h('label', { class: 'field wide' }, h('span', null, label), el, ...rest);
  const el = h('div', null,
    h('p', { class: 'hint' }, 'Сделали паспорт в другой программе — впишите номера, которые там поставили. Система запомнит их, и следующий паспорт получит номер дальше.'),
    f('Изделие *', prod), f('Сколько паспортов', qty, h('small', { class: 'muted' }, 'Например, 10 — получат 10 номеров подряд, начиная с № паспорта ниже')),
    f('Заказ', ord), f('Дата', dt), f('Заказчик', cust), f('№ паспорта (первого)', no, err), f('№ изделия (первого)', pc));
  return {
    el, dirty: () => !!prod.value.trim() || !!cust.value.trim(), focus: () => prod.focus(),
    read: () => ({ values: { save: async () => {
      err.textContent = '';
      const productId = ids.get(prod.value.trim());
      if (!productId) throw new Error('Выберите изделие из списка');
      const n = Math.min(50, Math.max(1, Math.floor(Number(qty.value) || 1)));
      const order = oids.get(ord.value.trim());
      if (ord.value.trim() && !order) throw new Error('Выберите заказ из списка или очистите поле');
      const body = { productId, qty: n, salesOrderId: order?.id, date: dt.value || undefined, customerName: cust.value.trim() || undefined, passportNumber: no.value.trim() || undefined, productCode: pc.value.trim() || undefined };
      if (body.passportNumber && !/^\d+$/.test(body.passportNumber)) throw new Error('№ паспорта — только цифры');
      let r;
      try { r = await api('/passports/external', { method: 'POST', body }); } catch (e) { err.textContent = e.message || 'Не удалось записать'; throw e; }
      const items = r.items || [];
      const a = items[0] || {}, z = items[items.length - 1] || {};
      toast(items.length > 1
        ? `Записано паспортов: ${items.length} — № ${a.passportNumber}–${z.passportNumber}, изделия № ${a.productCode}–${z.productCode}`
        : `Паспорт № ${a.passportNumber} записан: талон ${a.warrantyCode}, изделие № ${a.productCode}`);
      window.dispatchEvent(new Event('pn-refresh')); after?.();
      return r;
    } } }),
  };
}

export const passNum = {
  id: 'passnum', title: 'Записать номер', newTitle: 'Записать номер', card: { heading: () => 'Записать номер' }, get: async () => ({}),
  form: { build, toBody: (v) => v, create: (v) => v.save(), saveLabel: 'Сохранить', closeAfterCreate: true },
};
