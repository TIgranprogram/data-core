import { hint, textInput } from '../ui/kit/index.js';
import { pipeOrderFromMetres, pipeOrderFromPieces } from './request-cart-pipes.js';

export const canCountPipe = row => ['pieces', 'metres'].includes(row.pipe?.unitMode);
export const orderLength = row => row.orderLengthM || row.pipe?.lengthM;
export const hasPipeOrder = row => canCountPipe(row) && orderLength(row) > 0;
export const orderLineKey = row => JSON.stringify([row.materialId, row.orderLengthM || null]);
const typedLength = value => {
  const number = Number(String(value).trim().replace(',', '.'));
  return pipeOrderFromPieces(1, value)?.metres === number ? number : null;
};

export function pipeOrder(row, quantity) {
  if (!hasPipeOrder(row)) return null;
  return row.pipe.unitMode === 'pieces' ? pipeOrderFromPieces(quantity, orderLength(row))
    : pipeOrderFromMetres(quantity, orderLength(row));
}

// При наборе «12,5» оставляем курсор и десятичную запятую на месте.
// Парное поле обновляется сразу, закупочный метраж подставляется по выходу из поля.
export function pipeInputs(row, { quantity, disabled, onChange, onEnter, typed }) {
  const manual = !row.pipe.lengthM || !!row.orderLengthM;
  let lengthText = manual ? typed?.lengthText ?? row.orderLengthM ?? '' : '';
  let lengthM = manual ? typedLength(lengthText) : orderLength(row);
  let source = typed?.source || (quantity === undefined ? 'pieces' : row.pipe.unitMode);
  let raw = typed?.raw ?? quantity ?? '1';
  const calculate = () => source === 'pieces' ? pipeOrderFromPieces(raw, lengthM) : pipeOrderFromMetres(raw, lengthM);
  let order = calculate();
  const quantityInUnit = () => {
    if (order) return order[row.pipe.unitMode];
    if (!manual || String(lengthText).trim() || source !== row.pipe.unitMode) return null;
    // Без перевода между единицами сохраняем исходное количество склада.
    if (source === 'pieces') return pipeOrderFromPieces(raw, 1)?.pieces ?? null;
    return typedLength(raw);
  };
  const change = (key, value) => { source = key; raw = value; refresh(); };
  const make = (key, label, mode) => {
    const field = textInput({ value: order?.[key] ?? (source === key ? raw : ''), short: true, inputmode: mode, disabled,
      onInput: value => change(key, value), onEnter });
    field.input.setAttribute('aria-label', label + ': ' + row.name);
    return field;
  };
  const pieces = make('pieces', 'Штуки', 'numeric');
  const metres = make('metres', 'Метры', 'decimal');
  const length = manual ? textInput({ label: 'Длина для заказа, м', value: lengthText,
    short: true, inputmode: 'decimal', disabled, onEnter,
    onInput: value => {
      lengthText = value;
      lengthM = typedLength(value);
      refresh();
      if (order) { pieces.value = order.pieces; metres.value = order.metres; }
      else (source === 'pieces' ? pieces : metres).value = raw;
    } }) : null;
  length?.input.setAttribute('aria-label', 'Длина хлыста для заказа, м: ' + row.name);
  function refresh() {
    order = calculate();
    const other = source === 'pieces' ? metres : pieces;
    other.value = (source === 'pieces' ? order?.metres : order?.pieces) ?? '';
    onChange(quantityInUnit() ?? '', lengthM, { source, raw, lengthText: length?.value });
  }
  metres.input.addEventListener('blur', () => { if (order) metres.value = order.metres; });
  return { pieces, metres, length, lengthM: () => lengthM, quantity: quantityInUnit };
}

export function pipeDescription(row) {
  const info = [];
  if (row.grade) info.push(row.grade);
  if (orderLength(row) > 0) info.push('Хлыст ' + orderLength(row).toLocaleString('ru-RU') + ' м');
  else info.push('Длина хлыста не указана');
  return hint(info.join(' · '));
}

export function pipeWashStock(row, washed) {
  if (row.pipe.stockUnknown) return '—';
  const value = washed ? row.pipe.washedM : row.pipe.unwashedM;
  return value == null ? '—' : Number(value).toLocaleString('ru-RU', { maximumFractionDigits: 6 });
}

export function restorePipeDraft(draft, catalog, numberOf) {
  // Уже отправленный пакет повторяется с прежним составом. Старые открытые
  // черновики показываем с новыми названиями; округление пользователь
  // подтверждает вводом, прежде чем отправить или выгрузить заказ.
  if (!draft.pending && draft.rows.length) {
    const byMaterial = new Map(catalog.filter(row => row.pipe).flatMap(row =>
      (row.pipe.sourceMaterials || [row]).map(source => [source.materialId, row])));
    const incomplete = new Set(draft.rows.filter(line => numberOf(line.qty) == null)
      .map(line => byMaterial.get(line.materialId)?.materialId));
    const canonical = new Map();
    draft.rows = draft.rows.filter(line => {
      const current = byMaterial.get(line.materialId);
      if (!current || incomplete.has(current.materialId)) return true;
      const key = orderLineKey({ ...line, materialId: current.materialId });
      const same = canonical.get(key);
      if (same) {
        same.qty = Number((numberOf(line.qty) + numberOf(same.qty)).toPrecision(15));
        return false;
      }
      Object.assign(line, current);
      canonical.set(key, line);
      return true;
    });
  }
}
