import { api, session } from '../../core/api.js';
import { h } from '../../core/dom.js';
import { patch } from '../../core/router.js';
import { attachCombo } from '../../ui/combo.js';
import { toast } from '../../ui/toast.js';
import { productsAll } from './models.js';

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
  const [all, nx] = await Promise.all([productsAll(), api('/passports/next-numbers')]);
  const ids = new Map();
  const prod = h('input', { type: 'text', 'aria-label': 'Изделие', placeholder: 'Название или артикул', autocomplete: 'off' });
  attachCombo(prod, { options: () => all.map((p) => { const l = `${p.name}${p.sku ? ' · арт. ' + p.sku : ''}`; ids.set(l, p.id); return { label: l, value: p.id, sub: [p.type, p.group].filter(Boolean).join(' › ') }; }) });
  const dt = h('input', { type: 'date', 'aria-label': 'Дата', value: new Date().toISOString().slice(0, 10) });
  const cust = h('input', { type: 'text', 'aria-label': 'Заказчик', autocomplete: 'off' });
  const no = h('input', { type: 'text', inputmode: 'numeric', 'aria-label': 'Номер паспорта', value: nx.nextPassportNo ?? '' });
  const pc = h('input', { type: 'text', inputmode: 'numeric', 'aria-label': 'Номер изделия', value: nx.nextProductCode ?? '' });
  const err = h('div', { class: 'field-err', role: 'alert' });
  const f = (label, el, ...rest) => h('label', { class: 'field wide' }, h('span', null, label), el, ...rest);
  const el = h('div', null,
    h('p', { class: 'hint' }, 'Сделали паспорт в другой программе — впишите номера, которые там поставили. Система запомнит их, и следующий паспорт получит номер дальше.'),
    f('Изделие *', prod), f('Дата', dt), f('Заказчик', cust), f('№ паспорта', no, err), f('№ изделия', pc));
  return {
    el, dirty: () => !!prod.value.trim() || !!cust.value.trim(), focus: () => prod.focus(),
    read: () => ({ values: { save: async () => {
      err.textContent = '';
      const productId = ids.get(prod.value.trim());
      if (!productId) throw new Error('Выберите изделие из списка');
      const body = { productId, date: dt.value || undefined, customerName: cust.value.trim() || undefined, passportNumber: no.value.trim() || undefined, productCode: pc.value.trim() || undefined };
      if (body.passportNumber && !/^\d+$/.test(body.passportNumber)) throw new Error('№ паспорта — только цифры');
      let r;
      try { r = await api('/passports/external', { method: 'POST', body }); } catch (e) { err.textContent = e.message || 'Не удалось записать'; throw e; }
      toast(`Паспорт № ${r.passportNumber} записан: талон ${r.warrantyCode}, изделие № ${r.productCode}`);
      window.dispatchEvent(new Event('pn-refresh')); after?.();
      return r;
    } } }),
  };
}

export const passNum = {
  id: 'passnum', title: 'Записать номер', newTitle: 'Записать номер', card: { heading: () => 'Записать номер' }, get: async () => ({}),
  form: { build, toBody: (v) => v, create: (v) => v.save(), saveLabel: 'Сохранить', closeAfterCreate: true },
};
