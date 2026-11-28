import { h } from '../core/dom.js';
import { normSearch } from '../core/facets.js';
import { button, select } from '../ui/kit/index.js';
import { pipeWashStock } from './request-cart-pipe-input.js';
import { lastPurchaseText } from './request-cart-open-orders.js';
import { pipeCommitments } from './request-cart-pipes.js';

export const pipeFamilyKey = row => JSON.stringify([row.type, normSearch(row.name), row.pipe.material]);

/** Строки списка — закупочные типоразмеры. Вариант остаётся конкретной
 * складской позицией со своей мерной длиной, маркой, единицей и остатком. */
export function groupPipeVariants(rows, sort) {
  const groups = new Map();
  for (const row of rows) {
    const key = pipeFamilyKey(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const values = [...groups.values()];
  // Сортировка таблицы меняет порядок сортаментов, выбор длины остаётся стабильным.
  for (const variants of values) variants.sort((a, b) =>
    (a.pipe.lengthM ?? Infinity) - (b.pipe.lengthM ?? Infinity) || a.materialId.localeCompare(b.materialId));
  const balance = variants => variants.reduce((sum, { pipe }) => sum + pipe.washedM + pipe.unwashedM + pipe.unknownM, 0);
  return sort === 'stock' ? values.sort((a, b) => balance(b) - balance(a)) : values;
}

export function uniquePurchaseRows(rows) {
  const seen = new Set();
  return rows.filter(row => {
    if (!row.pipe) return true;
    const family = pipeFamilyKey(row);
    if (seen.has(family)) return false;
    seen.add(family);
    return true;
  });
}

function variantOptions(variants) {
  const grades = new Set(variants.map(row => row.grade));
  const standards = new Set(variants.map(row => row.pipe.standard));
  const labels = variants.map(row => [
    row.pipe.lengthM ? row.pipe.lengthM.toLocaleString('ru-RU') + ' м' : 'Не указана',
    grades.size > 1 ? row.grade || 'Без марки' : null,
    standards.size > 1 ? row.pipe.standard || 'Без стандарта' : null,
  ].filter(Boolean).join(' · '));
  return variants.map((row, i) => [row.materialId, labels.indexOf(labels[i]) === labels.lastIndexOf(labels[i])
    ? labels[i] : [labels[i], row.unit, row.article || row.materialId].join(' · ')]);
}

const format = (value, unit) => Number.isFinite(value) ? value.toLocaleString('ru-RU', { maximumFractionDigits: 6 }) + ' ' + unit : '—';

function stockTotals(row) {
  const { washedM, unwashedM, unknownM, stockUnknown, unitMode, lengthM } = row.pipe;
  const metres = stockUnknown ? null : washedM + unwashedM + unknownM;
  const equivalent = unitMode === 'metres' && lengthM > 0 && metres != null;
  const pieces = metres === 0 ? 0 : unitMode === 'pieces' && !stockUnknown ? row.quantity : equivalent ? metres / lengthM : null;
  return { pieces: format(pieces, 'шт'), metres: format(metres, 'м'), equivalent };
}

export function pipeVariantView(variants, row, { expanded, toggle, pick, colspan, editor }) {
  const trigger = button({ label: row.name, kind: 'ghost', size: 'S', cls: 'k-pipe-disclosure',
    title: 'Длина хлыста и наличие', onClick: toggle });
  trigger.setAttribute('aria-expanded', String(expanded));
  trigger.setAttribute('aria-label', row.name);
  if (!expanded) return { trigger };
  const options = variantOptions(variants);
  const length = options.length === 1 ? h('strong', null, options[0][1])
    : select({ label: 'Длина хлыста: ' + row.name, options, value: row.materialId, onChange: pick });
  const stock = (label, value) => [h('dt', null, label), h('dd', null, value === '—' ? value : value + ' м')];
  const totals = stockTotals(row), last = lastPurchaseText(row);
  const total = (unit, value, title) => h('td', { 'data-stock-total': unit, title }, h('strong', null, value));
  const summary = h('tr', { 'data-pipe-stock': true }, h('td', { rowspan: 3 }, h('div', null,
    options.length > 1 || !editor ? h('section', { 'data-pipe-length': true }, h('h3', null, 'Длина хлыста'), length) : null,
    editor ? h('div', { 'data-length-editor': true }, editor) : null,
    h('section', null, h('h3', null, 'На складе'), h('dl', null,
      stock('Мытые', pipeWashStock(row, true)), stock('Немытые', pipeWashStock(row, false)),
      row.pipe.unknownM > 0 ? stock('Мойка не указана', row.pipe.unknownM.toLocaleString('ru-RU')) : null))),
    last ? h('p', null, last) : null), h('td', { 'data-stock-label': true }, 'Всего на складе'),
  total('pieces', totals.pieces, totals.equivalent ? 'Количество хлыстов в пересчёте по метражу' : undefined),
  total('metres', totals.metres), h('td', { colspan: colspan - 4 }));
  const commitments = pipeCommitments(row);
  const commitment = (key, label) => h('tr', { 'data-pipe-commitment': key },
    h('td', null, label), h('td', null, format(commitments[key].pieces, 'шт')),
    h('td', null, format(commitments[key].metres, 'м')), h('td', { colspan: colspan - 4 }));
  const detail = document.createDocumentFragment();
  detail.append(summary, commitment('reserved', 'Бронь'), commitment('ordered', 'Заказано'));
  return { trigger, detail, length };
}
