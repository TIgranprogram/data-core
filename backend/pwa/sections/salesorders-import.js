/**
 * Импорт заказа из Excel (C019): шаблон → проверка полей → создание договора + позиций.
 * Формат: один лист, шапка «ключ | значение», затем строка «№ | НАИМЕНОВАНИЕ | …» и позиции.
 */
import { h } from '../core/dom.js';
import { api, session } from '../core/api.js';
import { downloadXlsx } from '../core/xlsx-write.js';
import { readTableFile } from '../core/xlsx-read.js';
import { toast, modal, errText } from '../ui/kit/index.js';
import { go } from '../core/router.js';

const HEAD_KEYS = {
  '№ договора': 'orderNo',
  '№ заказа': 'productionNo',
  'Заказчик': 'customer',
  'Наша компания': 'companyName',
  'Предмет': 'title',
  'Форма оплаты': 'paymentForm',
  'Срок изготовления': 'productionDeadline',
  'Окончание поставки': 'deliveryDeadline',
  'Дата отгрузки': 'shipDate',
  'Примечание': 'notes',
};

const clean = (v) => String(v ?? '').replace(/[\s\u00a0]+/g, ' ').trim();
const isHeaderRow = (cells) => clean(cells[0]) === '№' && /НАИМЕНОВАНИЕ/i.test(clean(cells[1] || ''));

/** Текст листа (Tab) → { header, lines, errors[], warnings[] }. */
export function parseOrderImport(text) {
  const rows = String(text || '').split(/\r?\n/).map((l) => l.split('\t').map(clean));
  const header = {};
  const lines = [];
  const errors = [];
  const warnings = [];
  let i = 0;
  while (i < rows.length && !isHeaderRow(rows[i])) {
    const [k, v] = rows[i];
    if (k && HEAD_KEYS[k] && v) header[HEAD_KEYS[k]] = v;
    i++;
  }
  if (i >= rows.length || !isHeaderRow(rows[i])) {
    errors.push('Не найдена таблица позиций (строка «№ | НАИМЕНОВАНИЕ | …»)');
    return { header, lines, errors, warnings, ok: false };
  }
  i++;
  for (; i < rows.length; i++) {
    const [no, title, unit, qtyRaw, priceRaw] = rows[i];
    if (!title && !unit && !qtyRaw) continue;
    if (!title) { errors.push(`Строка ${i + 1}: нет наименования`); continue; }
    const qty = Number(String(qtyRaw || '').replace(',', '.'));
    if (!Number.isFinite(qty) || qty <= 0) { errors.push(`«${title.slice(0, 40)}»: укажите количество > 0`); continue; }
    if (!unit) { errors.push(`«${title.slice(0, 40)}»: укажите единицу измерения`); continue; }
    const line = { lineNo: no && /^\d+$/.test(no) ? +no : lines.length + 1, title, unit, qty };
    if (priceRaw !== undefined && priceRaw !== '') {
      const p = Number(String(priceRaw).replace(/\s/g, '').replace(',', '.'));
      if (Number.isFinite(p) && p >= 0) line.unitPrice = p;
      else warnings.push(`«${title.slice(0, 40)}»: цена не число — пропущена`);
    }
    lines.push(line);
  }
  if (!clean(header.orderNo)) errors.push('Нет «№ договора»');
  if (!clean(header.customer)) errors.push('Нет «Заказчик»');
  if (!clean(header.companyName)) errors.push('Нет «Наша компания» (СИЮ или ССЮ)');
  else if (!/^(СИЮ|ССЮ|СпортИН-ЮГ|Спортстройюг)$/i.test(header.companyName) && !/спорт/i.test(header.companyName)) {
    warnings.push(`Компания «${header.companyName}» — проверьте, что это наша (СИЮ / ССЮ)`);
  }
  if (!lines.length) errors.push('Нет ни одной позиции');
  if (!clean(header.productionNo)) warnings.push('№ заказа пуст — сайт подставит следующий свободный (последний + 1)');
  return { header, lines, errors, warnings, ok: errors.length === 0 };
}

export function downloadOrderTemplate() {
  const rows = [
    ['Поле', 'Значение'],
    ['№ договора', '⚠ изменить номер договора'],
    ['№ заказа', ''],
    ['Заказчик', '⚠ изменить заказчика'],
    ['Наша компания', 'СИЮ'],
    ['Предмет', ''],
    ['Форма оплаты', 'б/р'],
    ['Срок изготовления', ''],
    ['Окончание поставки', ''],
    ['Дата отгрузки', ''],
    ['Примечание', ''],
    [],
    ['№', 'НАИМЕНОВАНИЕ', 'ЕД. ИЗМ.', 'КОЛ-ВО', 'ЦЕНА'],
    [1, 'Пример позиции — замените', 'шт', 1, ''],
  ];
  downloadXlsx('шаблон-заказ-импорт.xlsx', rows, 'Заказ');
}

function previewBody(parsed) {
  const { header, lines, errors, warnings, ok } = parsed;
  // только эталоны kit/form (design-lint R3/R4): без своих .so-imp-*
  const row = (k, v) => h('div', { class: 'field' }, h('span', null, k), h('div', null, v || '—'));
  return h('div', null,
    ok
      ? h('p', { class: 'muted' }, '✓ Сопоставление полей в порядке — можно загружать')
      : h('p', { class: 'form-error' }, 'Исправьте файл и загрузите снова'),
    errors.length ? h('div', { class: 'form-error' }, h('ul', null, ...errors.map((e) => h('li', null, e)))) : null,
    warnings.length ? h('p', { class: 'muted' }, warnings.map((w) => '⚠ ' + w).join(' · ')) : null,
    h('div', { class: 'section-title' }, 'Шапка'),
    h('div', { class: 'form-grid' },
      row('№ договора', header.orderNo),
      row('№ заказа', header.productionNo || '(подставится сам)'),
      row('Заказчик', header.customer),
      row('Наша компания', header.companyName),
      row('Предмет', header.title)),
    h('div', { class: 'section-title' }, `Позиции (${lines.length})`),
    h('ol', { class: 'muted' }, ...lines.slice(0, 40).map((l) =>
      h('li', null, `${l.title} — ${l.qty} ${l.unit}${l.unitPrice != null ? ` · ${l.unitPrice} ₽` : ''}`))),
    lines.length > 40 ? h('p', { class: 'muted' }, `…и ещё ${lines.length - 40}`) : null,
  );
}

async function uploadParsed(parsed) {
  const h0 = parsed.header;
  const companyName = /ссю|спортстрой/i.test(h0.companyName || '') ? 'ССЮ'
    : /сию|спортин/i.test(h0.companyName || '') ? 'СИЮ'
      : h0.companyName;
  const body = {
    orderNo: h0.orderNo,
    customer: h0.customer,
    companyName,
    title: h0.title || '',
    paymentForm: h0.paymentForm || '',
    notes: h0.notes || '',
    stage: 'new',
    ...(h0.productionNo ? { productionNo: h0.productionNo } : {}),
    ...(h0.productionDeadline ? { productionDeadline: h0.productionDeadline } : {}),
    ...(h0.deliveryDeadline ? { deliveryDeadline: h0.deliveryDeadline } : {}),
    ...(h0.shipDate ? { shipDate: h0.shipDate } : {}),
    clientUid: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
  };
  const order = await api('/salesorders', { method: 'POST', body });
  const orderId = order.id || order._id;
  for (const l of parsed.lines) {
    await api('/incomes', {
      method: 'POST',
      body: {
        orderId,
        title: l.title,
        qty: l.qty,
        unit: l.unit,
        ...(l.unitPrice != null ? { unitPrice: l.unitPrice } : {}),
        customer: body.customer,
        orderNo: body.orderNo,
      },
    });
  }
  return order;
}

/** Выбор файла → проверка → загрузка. */
export async function importOrderExcel() {
  if (!session.canEditOrders) { toast('Нет права создавать заказы'); return null; }
  const file = await new Promise((resolve) => {
    const inp = h('input', { type: 'file', accept: '.xlsx,.csv,.txt', hidden: true });
    inp.onchange = () => { resolve(inp.files?.[0] || null); inp.remove(); };
    document.body.append(inp);
    inp.click();
  });
  if (!file) return null;
  let parsed;
  try { parsed = parseOrderImport(await readTableFile(file)); }
  catch (e) { toast(errText(e)); return null; }
  const saved = await modal({
    title: 'Импорт заказа из Excel',
    okText: parsed.ok ? 'Загрузить на сайт' : 'Понятно',
    cancelText: parsed.ok ? 'Отмена' : 'Закрыть',
    wide: true,
    body: previewBody(parsed),
    onOk: async () => {
      if (!parsed.ok) return true;
      const order = await uploadParsed(parsed);
      toast(`Заказ загружен: ${order.productionNo || order.orderNo || ''} · позиций ${parsed.lines.length}`);
      return order;
    },
  });
  if (saved && typeof saved === 'object' && (saved.id || saved._id)) {
    go('salesorders', { open: saved.productionNo || saved.id || saved._id });
    window.dispatchEvent(new CustomEvent('data-changed'));
  }
  return saved && typeof saved === 'object' ? saved : null;
}
