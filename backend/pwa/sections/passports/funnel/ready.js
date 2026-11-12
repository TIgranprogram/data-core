import { readyFileNumber, readyFileDirty } from '../form-state.js';
import { api } from '../../../core/api.js';
import { h } from '../../../core/dom.js';
import { patch } from '../../../core/router.js';
import { attachCombo, button, enhanceSelect, fileButton, hint, link, searchBox, select, sideNote, sku, stack, table, textInput, toast, toastError } from '../../../ui/kit/index.js';
import { ourCompanies } from '../common.js';
import { funnelData, getProduct } from './api.js';

/**
 * «Добавить готовый паспорт» (C072, П-1): паспорт сделан отдельно, есть файл. Правая панель по шагам:
 * Файл (PDF) → Фирма → Изделие → Заказ («без заказа» одним нажатием) → Номер (предложен следующий, можно заменить).
 * Пройденный шаг — строка «Фирма: … ✎»; сверху «Дальше: …». Подставленное из карточки изделия / заказа считается пройденным.
 * Сервер: POST /passports/ready (multipart), проверки номера, фирмы и позиции — на сервере, ответ 409 показывается под полем номера.
 *   readyPanel({ productId?, salesOrderId?, incomeId?, orderNo?, customerName? }) → объект формы панели
 */
const STEPS = ['file', 'firm', 'prod', 'order', 'number'];
const orderLabel = (o) => `№ ${o.orderNo || o.productionNo || 'без номера'}${o.customer ? ' · ' + o.customer : ''}`;
const isPdf = (f) => !f.type ? /\.pdf$/i.test(f.name || '') : f.type === 'application/pdf' || /\.pdf$/i.test(f.name || '');

export function readyPanel(entry = {}) {
  const S = { file: null, firmId: '', prod: null, orderId: entry.salesOrderId || '', orderText: entry.orderNo ? `№ ${entry.orderNo}${entry.customerName ? ' · ' + entry.customerName : ''}` : '', noOrder: false, incomeId: entry.incomeId || '', number: '', suggested: '' };
  let firms = []; let orders = null; let editing = ''; let found = []; let numErr = ''; let saving = false; let saved = false; let seq = 0;
  const nextEl = h('div'); const body = stack(); const box = stack(nextEl, body);
  const say = (t) => nextEl.replaceChildren(t ? sideNote('Дальше: ' + t) : '');

  const done = {
    file: () => !!S.file,
    firm: () => !!S.firmId,
    prod: () => !!S.prod,
    order: () => !!S.orderId || S.noOrder,
    number: () => false,
  };
  const active = () => editing || STEPS.find((k) => !done[k]());
  const edit = (k) => { editing = k; paint(); };
  const next = (k) => { if (editing === k) editing = ''; paint(); };

  const firmName = () => firms.find((f) => f.id === S.firmId)?.name || '';
  const RECAP = {
    file: () => { const n = String(S.file?.name || ''); return `Файл: ${n.length > 40 ? n.slice(0, 37) + '…' : n} ✎`; },
    firm: () => `Фирма: ${firmName()} ✎`,
    prod: () => `Изделие: ${S.prod?.sku ? S.prod.sku + ' ' : ''}${S.prod?.name} ✎`,
    order: () => `Заказ: ${S.noOrder ? 'без заказа' : S.orderText || 'выбран'} ✎`,
  };

  // ── шаг 1: файл ──
  const fileStep = () => [
    hint('Выберите PDF готового паспорта (до 20 МБ). Он прикрепится к паспорту и будет печататься как есть.'),
    fileButton({ label: 'Выбрать PDF…', accept: 'application/pdf,.pdf', size: 'M', onFile: (f) => {
      if (!isPdf(f)) { toast('Нужен файл PDF', { error: true }); return; }
      S.file = f; next('file');
    } }),
  ];

  // ── шаг 2: фирма ──
  const firmStep = () => {
    if (!firms.length) return [hint('Нет наших фирм. Добавьте компанию в контрагентах.', 'warn')];
    const sel = select({ label: 'Фирма', value: S.firmId, options: [['', 'Выберите фирму'], ...firms.map((f) => [f.id, f.name])], onChange: (v) => { S.firmId = v; if (v) next('firm'); } });
    queueMicrotask(() => enhanceSelect(sel));
    return [hint('От какой нашей фирмы выдан паспорт.'), h('label', { class: 'field' }, h('span', null, 'Фирма'), sel)];
  };

  // ── шаг 3: изделие ──
  const prodStep = () => {
    const out = h('div');
    const paintList = (resp, q) => {
      const items = resp?.products?.items || [];
      out.replaceChildren(table({
        label: 'Изделия', clickable: true, maxHeight: 'M',
        columns: [{ label: 'Изделие' }],
        rows: items.map((it) => ({ onClick: () => { S.prod = { id: it.id, name: it.name, sku: it.sku }; next('prod'); }, data: it.id, cells: [h('div', null, h('div', { title: it.name }, it.name), sku(it.sku))] })),
        empty: { title: q ? 'Такого изделия нет' : 'Введите название или артикул', hint: q ? 'Проверьте написание или создайте изделие в разделе «Продукция».' : 'Список появится, когда начнёте искать.' },
      }));
    };
    const run = async (q) => {
      const my = ++seq;
      if (!q) { paintList(null, ''); return; }
      try { const resp = await funnelData({ q }); if (my === seq) paintList(resp, q); } catch (e) { toastError(e, 'найти изделие'); }
    };
    const sb = searchBox({ placeholder: 'Название или артикул', onSearch: run });
    paintList(null, '');
    queueMicrotask(() => sb.input?.focus());
    return [sb.el, out];
  };

  // ── шаг 4: заказ ──
  const orderStep = () => {
    const f = textInput({ label: 'Заказ', placeholder: 'Номер заказа или заказчик' });
    const loadOrders = async () => { orders ??= (await api('/salesorders', { query: { filter: 'all', limit: 500, sort: '-createdAt' } }).catch(() => null))?.items || []; return orders; };
    loadOrders().then(() => {
      attachCombo(f.input, { options: () => (orders || []).map((o) => ({ value: o.id, label: orderLabel(o), sub: '', o })), free: false,
        onPick: (opt) => { S.orderId = String(opt.value); S.orderText = opt.label; S.noOrder = false; S.incomeId = ''; adoptFirm(opt.o); next('order'); } });
    });
    return [
      hint('К какому заказу относится паспорт. Заказ можно не указывать.'),
      button({ label: 'Без заказа', kind: 'primary', onClick: () => { S.noOrder = true; S.orderId = ''; S.orderText = ''; S.incomeId = ''; next('order'); } }),
      f.el,
    ];
  };

  // ── шаг 5: номер ──
  const onNumber = (v) => {
    S.number = String(v).trim(); numErr = '';
    const my = ++seq;
    if (/^\d+$/.test(S.number) && S.number !== S.suggested) {
      api('/passports', { query: { search: S.number, limit: 20 } }).then((r) => {
        if (my !== seq) return;
        const hit = (r.items || []).find((x) => String(x.passportNumber) === S.number);
        found = hit ? [hit] : [];
        numNote();
      }).catch(() => {});
    } else { found = []; numNote(); }
  };
  const numNoteEl = h('div');
  const saveBtn = () => button({ label: 'Сохранить паспорт', kind: 'primary', disabled: saving || !!found.length || !!numErr || !/^\d+$/.test(S.number), onClick: save });
  const numNote = () => {
    const bad = !/^\d+$/.test(S.number);
    const msg = bad ? 'Номер — целое число' : numErr || (found.length ? `Номер ${S.number} уже у паспорта «${found[0].name || 'без названия'}»` : '');
    numNoteEl.replaceChildren(...[msg ? hint(msg, 'warn') : null, h('div', null, saveBtn())].filter(Boolean));
  };
  const numberStep = () => {
    const f = textInput({ label: 'Номер паспорта', value: S.number, inputmode: 'numeric', max: 9, onInput: onNumber, onEnter: () => {} });
    numNote();
    return [hint(S.suggested ? `Предложен следующий свободный номер — ${S.suggested}. Если в файле другой, впишите его.` : 'Номер можно не вписывать — возьмётся следующий свободный.'), f.el, numNoteEl];
  };

  const STEP_VIEW = { file: fileStep, firm: firmStep, prod: prodStep, order: orderStep, number: numberStep };
  const TITLE = { file: 'укажите файл PDF', firm: 'выберите фирму', prod: 'найдите изделие', order: 'выберите заказ или «Без заказа»', number: 'проверьте номер и сохраните паспорт' };

  function paint() {
    const act = active();
    say(TITLE[act]);
    body.replaceChildren(...STEPS.flatMap((k) => {
      if (k === act) return [stack(...STEP_VIEW[k]())];
      return done[k]() ? [link({ label: RECAP[k](), title: 'Изменить', onClick: () => edit(k) })] : [];
    }));
  }

  function adoptFirm(o) {
    const id = String(o?.companyId || o?.company?.id || '');
    if (!S.firmId && id && firms.some((f) => f.id === id)) S.firmId = id;
  }

  async function lineFor() {
    if (S.incomeId || !S.orderId || !S.prod) return S.incomeId || '';
    try {
      const doc = await api(`/salesorders/${S.orderId}`);
      const mine = (doc.lines || []).filter((l) => !l.cancelledAt && l.status !== 'cancelled' && String(l.productId || '') === String(S.prod.id));
      return mine.length === 1 ? String(mine[0].id || mine[0]._id) : '';
    } catch { return ''; }
  }

  async function save() {
    if (saving) return;
    if (!/^\d+$/.test(S.number)) { toast('Укажите номер из файла', { error: true }); return; }
    saving = true; numNote();
    try {
      const fd = new FormData();
      fd.append('file', S.file, S.file.name || 'passport.pdf');
      fd.append('productId', S.prod.id);
      fd.append('supplierOrgId', S.firmId);
      if (S.orderId) fd.append('salesOrderId', S.orderId);
      const inc = await lineFor();
      if (inc) fd.append('incomeId', inc);
      fd.append('number', readyFileNumber(S));
      const r = await api('/passports/ready', { method: 'POST', body: fd });
      toast(`Паспорт № ${r.passportNumber || ''} добавлен`.replace('  ', ' '));
      saved = true;
      window.dispatchEvent(new CustomEvent('data-changed'));
      patch({ of: undefined, new: undefined });
    } catch (e) {
      if (e?.status === 409 || e?.status === 400) { numErr = e.message || 'Не удалось сохранить'; numNote(); }
      else toastError(e, 'добавить паспорт');
    } finally { saving = false; numNote(); }
  }

  // старт: подставленное из карточки изделия / заказа
  (async () => {
    try { firms = (await ourCompanies()).map((o) => ({ id: String(o.id), name: o.name || 'Фирма' })); } catch { firms = []; }
    if (firms.length === 1) S.firmId = firms[0].id;
    if (S.orderId) { try { const o = await api(`/salesorders/${S.orderId}`); S.orderText = orderLabel(o); adoptFirm(o); } catch { /* заказ останется как номер */ } }
    if (entry.productId) { try { const p = await getProduct(entry.productId); S.prod = { id: p.id, name: p.name, sku: p.sku }; } catch { /* изделие выберут вручную */ } }
    try { const n = await api('/passports/next-numbers'); if (n?.nextPassportNo) { S.suggested = String(n.nextPassportNo); S.number = S.suggested; } } catch {
      try { const l = await api('/passports/last-numbers'); if (l?.last) { S.suggested = String(Number(l.last) + 1); S.number = S.suggested; } } catch { /* номер не предложен */ }
    }
    paint();
  })();
  paint();

  return { el: box, readonly: true, dirty: () => readyFileDirty(S, saved), focus: () => {}, read: () => ({ values: {} }) };
}
