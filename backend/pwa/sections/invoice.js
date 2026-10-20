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

  /**
   * Позиция счёта (TASKS В.3, замечание 2026-10-20): сначала «Категория», потом «Позиция» — только из этой категории.
   * Нет в списке — «+ Новая позиция»: форма в самой строке (наименование, артикул, ед., ссылка, фото) создаёт позицию
   * склада в выбранной категории и подставляет её в строку.
   */
  function addRow(focus = true) {
    const cat = h('input', { maxlength: 100, placeholder: 'Выберите категорию' });
    const title = h('input', { placeholder: 'Сначала выберите категорию', maxlength: 500, disabled: true });
    const q = h('input', { inputmode: 'decimal', value: '1', class: 'inv-q', 'aria-label': 'Количество' });
    const unit = h('input', { value: 'шт', maxlength: 30, class: 'inv-u', 'aria-label': 'Ед. изм.' });
    const sum = h('input', { inputmode: 'decimal', placeholder: 'сумма, ₽', class: 'inv-s', hidden: !session.canMoney, 'aria-label': 'Сумма' });
    const row = { title, q, unit, sum, cat, url: { value: '' }, photos: { ids: () => [] }, extra: {}, el: null };
    // форма новой позиции — в строке, нашим блоком
    const nName = h('input', { maxlength: 300, placeholder: 'Как называется: «Болт мебельный, M8х40, DIN 603»' });
    const nArt = h('input', { maxlength: 100, placeholder: 'пусто — присвоится сам' });
    const nUnit = h('input', { value: 'шт', maxlength: 30 });
    const nUrl = h('input', { maxlength: 1000, placeholder: 'https://…' });
    const nPhotos = photoField([]);
    const nErr = h('div', { class: 'err', hidden: true });
    const nSave = h('button', { type: 'button', class: 'btn btn-primary btn-sm' }, 'Создать позицию');
    const nBox = h('div', { class: 'form-block inv-new', 'data-tone': 'info', hidden: true },
      h('div', { class: 'inv-new-head' }, h('b', null, 'Новая позиция в базе'), h('span', { class: 'muted small' }, ' — появится на складе в выбранной категории')),
      h('div', { class: 'form-grid' }, field('Наименование *', nName, 'wide'), field('Артикул', nArt), field('Ед. изм.', h('div', { class: 'has-combo' }, nUnit)), field('Ссылка на товар', nUrl, 'wide'),
        h('div', { class: 'field wide' }, h('span', null, 'Фото'), nPhotos.el)),
      nErr, h('div', { class: 'inv-new-foot' }, nSave, h('button', { type: 'button', class: 'btn btn-sm', onclick: () => { nBox.hidden = true; } }, 'Отмена')));
    const addNew = h('button', { type: 'button', class: 'btn btn-sm', disabled: true, title: 'Нет в списке — добавить в базу', onclick: () => { nBox.hidden = false; nName.value = title.value.trim(); nName.focus(); } }, '+ Новая позиция');
    const del = h('button', { type: 'button', class: 'btn btn-ghost btn-icon btn-sm', title: 'Убрать позицию', onclick: () => { rows.splice(rows.indexOf(row), 1); row.el.remove(); recalc(); } }, '×');
    row.el = h('div', { class: 'inv-row' },
      h('div', { class: 'inv-pick' }, field('Категория', h('div', { class: 'has-combo' }, cat)), field('Позиция', h('div', { class: 'has-combo' }, title))),
      h('div', { class: 'inv-main' }, field('Кол-во', q), field('Ед.', h('div', { class: 'has-combo' }, unit)), session.canMoney ? field('Сумма, ₽', sum) : h('span'), h('div', { class: 'inv-btns' }, addNew, del)),
      nBox);
    lines.append(row.el);
    let catSel = '';
    const setCat = (name) => {
      catSel = name;
      title.disabled = !name; addNew.disabled = !name;
      title.placeholder = name ? `Позиция из «${name}» — начните печатать или выберите` : 'Сначала выберите категорию';
    };
    attachCombo(cat, { options: () => (lk.categories || []).map((c) => ({ label: c.name })), onPick: (o) => { setCat(o.label); title.value = ''; row.extra = {}; title.focus(); } });
    cat.addEventListener('change', () => { const v = cat.value.trim(); const c = (lk.categories || []).find((x) => x.name.toLowerCase() === v.toLowerCase()); setCat(c ? c.name : ''); });
    attachCombo(title, {
      options: () => items.filter((x) => x.cat === catSel).map((x) => ({ label: x.label, sub: x.sub, x })),
      onPick: (o) => { const v = o.x.values || {}; row.picked = o.label; if (v.unit) unit.value = v.unit; row.extra = { article: v.article }; if (!sup.value && v.supplierName) sup.value = v.supplierName; },
    });
    title.addEventListener('input', () => { if (title.value !== row.picked) row.extra = {}; });
    attachCombo(unit, { options: () => [...new Set([...UNITS, ...(lk.units || [])])].map((u) => ({ label: u })) });
    attachCombo(nUnit, { options: () => [...new Set([...UNITS, ...(lk.units || [])])].map((u) => ({ label: u })) });
    nSave.addEventListener('click', async () => {
      const name = nName.value.trim();
      if (!name) { nErr.textContent = 'Впишите наименование'; nErr.hidden = false; return; }
      nSave.disabled = true; nErr.hidden = true;
      try {
        let it = await api('/stock/items', { method: 'POST', body: { name, unit: nUnit.value.trim() || 'шт', categoryName: catSel, ...(nArt.value.trim() ? { article: nArt.value.trim() } : {}), ...(nUrl.value.trim() ? { notes: 'Ссылка: ' + nUrl.value.trim() } : {}) } });
        for (const photoId of nPhotos.ids()) it = await api(`/stock/items/${it.id}/photos`, { method: 'POST', body: { photoId } });
        // в списки и в строку
        items.unshift({ label: it.name, cat: catSel, sub: [catSel, 'новая'].join(' · '), values: { title: it.name, unit: it.unit, categoryName: catSel, article: it.article } });
        title.value = it.name; row.picked = it.name; unit.value = it.unit || 'шт'; row.extra = { article: it.article };
        row.url = { value: nUrl.value.trim() };
        nBox.hidden = true;
        toast(`Позиция «${it.name}» добавлена в базу`);
        q.focus(); q.select();
      } catch (e) { nErr.textContent = e.message; nErr.hidden = false; } finally { nSave.disabled = false; }
    });
    sum.addEventListener('input', recalc);
    sum.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addRow(); } });
    rows.push(row);
    if (focus) cat.focus();
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

  const start = () => JSON.stringify([no.value, date.value, sup.value, company.value, type.value, state, rows.map((r) => [r.cat.value, r.title.value, r.q.value, r.unit.value, r.sum.value])]);
  const initialSnap = start();
  async function save() {
    const invoiceNo = no.value.trim();
    if (!invoiceNo) throw new Error('впишите № счёта');
    const list = rows.filter((r) => r.title.value.trim());
    if (!list.length) throw new Error('добавьте хотя бы одну позицию');
    for (const r of list) if (!r.cat.value.trim()) throw new Error(`выберите категорию для «${r.title.value.trim()}»`);
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
        for (const el of [r.title, r.q, r.unit, r.sum, r.cat]) el.disabled = true;
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
