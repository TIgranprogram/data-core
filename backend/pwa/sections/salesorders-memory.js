import { api } from '../core/api.js';
import { h } from '../core/dom.js';
import { ORDER_PRIORITY } from '../ui/kit/badges.js';
import { button, row as kitRow, stack } from '../ui/kit/index.js';

/**
 * Память формы «+ Договор» (C033 п.5): поля «Заказчик» (с числом прошлых заказов), «Похоже: как в прошлый раз — верно?»
 * (наша компания, форма оплаты, приоритет — из ПОСЛЕДНЕГО заказа заказчика) и «№ заказа: новый / существующий».
 * Память — прошлые заказы (GET /salesorders), новых полей нет. → массив полей формы для salesorders.form.fields.
 */
const key = (s) => String(s || '').trim().toLowerCase();
const prodNo = (r) => r?.productionNo || 'нет №';

async function pastOrders() {
  const items = (await api('/salesorders', { query: { filter: 'all', limit: 1000, sort: '-createdAt' } }).catch(() => null))?.items || [];
  const by = new Map();
  for (const o of items) { const k = key(o.customer); if (!k) continue; const e = by.get(k) || { n: 0, last: o }; e.n += 1; by.set(k, e); } // от новых к старым: первый — последний заказ
  return by;
}

function likeWidget(by, companies) {
  const box = stack(); box.hidden = true;
  const clear = () => { box.hidden = true; box.replaceChildren(); };
  const show = (fa) => {
    const o = by.get(key(fa.get('customer')))?.last;
    const have = o && [o.companyName, o.paymentForm, o.priority && ORDER_PRIORITY[o.priority]?.label].filter(Boolean);
    if (!have?.length) return clear();
    box.hidden = false;
    box.replaceChildren(
      kitRow({ tone: 'info', title: `Похоже: как в прошлый раз (заказ № ${prodNo(o)}) — верно?`, meta: have.join(' · ') }),
      button({ label: 'Да, как в прошлый раз', kind: 'primary', onClick: () => {
        const put = (k, v) => v && fa.set(k, v, { auto: true, src: 'из прошлого заказа' });
        put('companyName', companies.some((c) => c.name === o.companyName) && o.companyName);
        put('paymentForm', o.paymentForm); put('priority', o.priority);
        clear();
      } }));
  };
  return { widget: { el: box, get value() { return ''; }, set value(_) { /* только показ */ } }, show };
}

/** Поля «Заказчик» → [«Похоже…»] → [«№ заказа: новый / существующий»]; поле productionNo остаётся в форме заказов. */
export async function memoryFields({ row, customers, companies, next, needNo }) {
  const by = row ? new Map() : await pastOrders();
  const options = [...new Set([...customers, ...[...by.values()].map((e) => e.last.customer)])].map((c) => ({ value: c, label: c, sub: by.has(key(c)) ? `заказов: ${by.get(key(c)).n}` : '' }));
  const like = likeWidget(by, companies);
  return [
    { key: 'customer', label: 'Заказчик', type: 'combo', required: true, options, max: 300,
      hint: row ? undefined : 'Выберите заказчика — подскажем компанию, форму оплаты и приоритет из его прошлого заказа.',
      mount: (fa) => { if (!row) fa.on('customer', () => like.show(fa)); } },
    ...(row ? [] : [{ key: '_like', type: 'widget', label: '', wide: true, widget: () => like.widget }]),
    ...(needNo ? [{ key: '_noMode', label: 'Заказ', type: 'segment', options: [{ value: 'new', label: 'Новый заказ' }, { value: 'existing', label: 'В существующий заказ' }],
      hint: 'Новый — возьмём следующий свободный №; существующий — выберите № ниже, договоры объединятся.',
      mount: (fa) => fa.on('_noMode', () => {
        if (fa.get('_noMode') === 'new') { if (next) fa.set('productionNo', next, { auto: true }); return; }
        if (fa.get('_noMode') !== 'existing') return; // при открытии формы ничего не раскрываем сами (приёмка дизайнера)
        fa.set('productionNo', ''); fa.input('productionNo')?.focus?.();
      }) }] : []),
  ];
}
