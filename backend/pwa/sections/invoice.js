import { api, session } from '../core/api.js';
import { h } from '../core/dom.js';
import { isoDay, money, parseNum, qty } from '../core/format.js';
import { attachCombo } from '../ui/combo.js';
import { photoField } from '../ui/photos.js';
import { toast } from '../ui/toast.js';
import { lookups, UNITS } from './lookups.js';
import { pastItems } from './requests.js';

/**
 * «+ Счёт» (TASKS В.3): уже оплаченный / полученный счёт, которого не было в заявках — вносится одним окном.
 * Шапка счёта общая, позиции — из базы (как «Категория → Позиция») или вручную; на каждую позицию создаётся
 * обычная заявка с тем же № и датой счёта (POST /supply/requests), «получено» — сразу приход на склад
 * (POST /supply/requests/:id/receive). Повтор безопасен (clientUid на строку).
 */
const STATE = [
  { value: 'ordered', label: 'Заказано — ждём', status: 'В работе' },
  { value: 'paid', label: 'Оплачено', status: 'Оплачено' },
  { value: 'received', label: 'Получено — на склад', status: 'Оплачено' },
];
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random());

/** Форма счёта для правой панели (card.js: section.form.build): { el, read, dirty, focus }. */
async function buildInvoiceForm() {
  const [lk, items] = await Promise.all([lookups(), pastItems().catch(() => [])]);
  const field = (label, el, cls = '') => h('label', { class: 'field ' + cls }, h('span', null, label), el);
  const no = h('input', { maxlength: 100, placeholder: 'например: 01097' });
  const date = h('input', { type: 'date', value: isoDay() });
  const sup = h('input', { maxlength: 200 });
  const company = h('select', null, h('option', { value: '' }, '—'), ...(lk.companies || []).map((c) => h('option', { value: c }, c)));
  const type = h('input', { maxlength: 60 });
  let state = 'received';
  const stateBox = h('div', { class: 'fseg' }, ...STATE.map((s) => h('button', { type: 'button', class: 'fseg-btn' + (s.value === state ? ' on' : ''), onclick: (e) => { state = s.value; stateBox.querySelectorAll('.fseg-btn').forEach((b) => b.classList.toggle('on', b === e.currentTarget)); } }, s.label)));
  const lines = h('div', { class: 'inv-lines' });
  const totalEl = h('b', { class: 'num' });
  const rows = [];

  function addRow(focus = true) {
    const title = h('input', { placeholder: 'Позиция: из списка или вручную', maxlength: 500 });
    const q = h('input', { inputmode: 'decimal', value: '1', class: 'inv-q' });
    const unit = h('input', { value: 'шт', maxlength: 30, class: 'inv-u' });
    const sum = h('input', { inputmode: 'decimal', placeholder: 'сумма, ₽', class: 'inv-s', hidden: !session.canMoney });
    const cat = h('input', { maxlength: 100, placeholder: 'категория' });
    const url = h('input', { maxlength: 1000, placeholder: 'ссылка на товар https://…' });
    const photos = photoField([]);
    const more = h('div', { class: 'inv-more', hidden: true }, field('Категория', cat), field('Ссылка', url, 'wide'), h('div', { class: 'field wide' }, h('span', null, 'Фото'), photos.el));
    const row = { title, q, unit, sum, cat, url, photos, extra: {}, el: null };
    const del = h('button', { type: 'button', class: 'btn btn-ghost btn-icon btn-sm', title: 'Убрать позицию', onclick: () => { rows.splice(rows.indexOf(row), 1); row.el.remove(); recalc(); } }, '×');
    const tog = h('button', { type: 'button', class: 'btn btn-ghost btn-sm', title: 'Категория, ссылка, фото', onclick: () => { more.hidden = !more.hidden; } }, 'ещё');
    row.el = h('div', { class: 'inv-row' }, h('div', { class: 'inv-main' }, h('div', { class: 'has-combo inv-t' }, title), q, unit, sum, tog, del), more);
    lines.append(row.el);
    attachCombo(title, {
      options: () => items.map((x) => ({ label: x.label, sub: x.sub, group: x.cat || 'Без категории', x })),
      onPick: (o) => { const v = o.x.values || {}; row.picked = o.label; if (v.unit) unit.value = v.unit; if (v.categoryName) cat.value = v.categoryName; row.extra = { article: v.article }; if (!sup.value && v.supplierName) sup.value = v.supplierName; },
    });
    attachCombo(unit, { options: () => [...new Set([...UNITS, ...(lk.units || [])])].map((u) => ({ label: u })) });
    attachCombo(cat, { options: () => (lk.categories || []).map((c) => ({ label: c.name })) });
    title.addEventListener('input', () => { if (title.value !== row.picked) row.extra = {}; });
    sum.addEventListener('input', recalc);
    sum.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addRow(); } });
    rows.push(row);
    if (focus) title.focus();
  }
  function recalc() { totalEl.textContent = money(rows.reduce((s, r) => s + (parseNum(r.sum.value) || 0), 0)); }

  const body = h('div', { class: 'inv' },
    h('p', { class: 'hint' }, 'Счёт, которого не было в заявках (уже оплатили / уже привезли). На каждую позицию будет заявка с этим счётом — расходы и склад посчитаются как обычно.'),
    h('div', { class: 'form-grid inv-head' }, field('№ счёта *', no), field('Дата счёта', date), field('Поставщик', h('div', { class: 'has-combo' }, sup)), field('Наша компания', company), field('Тип счёта', h('div', { class: 'has-combo' }, type)), h('div', { class: 'field wide' }, h('span', null, 'Что уже произошло'), stateBox)),
    h('div', { class: 'section-title' }, 'Позиции счёта'),
    lines,
    h('div', { class: 'inv-foot' }, h('button', { type: 'button', class: 'btn btn-sm', onclick: () => addRow() }, '+ позиция'), h('span', { class: 'spacer' }), session.canMoney ? h('span', null, 'Итого: ', totalEl) : null));
  attachCombo(sup, { options: () => (lk.suppliers || []).map((s) => ({ label: s })) });
  attachCombo(type, { options: () => (lk.invoiceTypes || []).map((s) => ({ label: s })) });
  addRow(false);
  recalc();

  const start = () => JSON.stringify([no.value, date.value, sup.value, company.value, type.value, state, rows.map((r) => [r.title.value, r.q.value, r.unit.value, r.sum.value, r.cat.value, r.url.value, r.photos.ids()])]);
  const initialSnap = start();
  async function save() {
    const invoiceNo = no.value.trim();
    if (!invoiceNo) throw new Error('впишите № счёта');
    const list = rows.filter((r) => r.title.value.trim());
    if (!list.length) throw new Error('добавьте хотя бы одну позицию');
    for (const r of list) if (!(parseNum(r.q.value) > 0)) throw new Error(`укажите количество для «${r.title.value.trim()}»`);
    const st = STATE.find((s) => s.value === state);
    for (const r of list) {
      r.uid ??= uid();
      const body2 = {
        title: r.title.value.trim(), qty: parseNum(r.q.value), unit: r.unit.value.trim() || 'шт', categoryName: r.cat.value.trim(),
        supplierName: sup.value.trim(), companyName: company.value, invoiceType: type.value.trim(), invoiceNo, invoiceDate: date.value || '',
        productUrl: r.url.value.trim(), photoIds: r.photos.ids(), statusLabel: st.status, priorityLabel: 'Обычный', requestDate: date.value || isoDay(),
        clientUid: r.uid, ...(r.extra.article ? { article: r.extra.article } : {}),
      };
      if (session.canMoney && parseNum(r.sum.value) > 0) body2.priceHint = parseNum(r.sum.value);
      if (!r.saved) {
        r.saved = await api('/supply/requests', { method: 'POST', body: body2 }); // повтор после ошибки не задваивает
        // внесённую строку больше не править (при сбое на следующей — видно, что эта уже в базе)
        for (const el of [r.title, r.q, r.unit, r.sum, r.cat, r.url]) el.disabled = true;
        r.el.classList.add('inv-done'); r.el.querySelectorAll('button').forEach((b) => { b.disabled = true; });
      }
      if (state === 'received' && !r.received) { await api(`/supply/requests/${r.saved.id}/receive`, { method: 'POST', body: { qty: parseNum(r.q.value), clientUid: 'inv-' + r.uid } }); r.received = true; }
    }
    toast(`Счёт ${invoiceNo} внесён: ${list.length} ${list.length === 1 ? 'позиция' : 'позиций'}${state === 'received' ? ', товар на складе' : ''}`);
    return { id: null, invoiceNo, count: list.length };
  }
  return { el: body, read: () => ({ values: { save } }), dirty: () => start() !== initialSnap, focus: () => no.focus() };
}

/** Раздел-«форма» для правой панели: открывается как новая запись (#requests?of=invoice&new=1), после «Внести» панель закрывается. */
export const invoice = {
  id: 'invoice',
  title: 'Счёт',
  newTitle: 'Внести счёт',
  card: { heading: () => 'Счёт' },
  get: async () => ({}),
  form: {
    build: () => buildInvoiceForm(),
    toBody: (v) => v,
    create: (v) => v.save(),
    saveLabel: 'Внести',
    closeAfterCreate: true,
  },
};
