import { normSearch } from '../core/facets.js';

function positive(value) {
  if (typeof value !== 'number' && !/^(?:\d+(?:[.,]\d+)?|[.,]\d+)$/.test(String(value ?? '').trim())) return null;
  const number = Number(String(value).replace(',', '.'));
  return Number.isFinite(number) && number > 0 ? number : null;
}

// Размеры каталога заданы в мм с точностью до 0,01 мм. Считаем в целых
// долях метра, чтобы, например, 2,1 / 0,7 не превращалось в четыре хлыста.
const PRECISION = 1000000;
export function pipeOrderFromPieces(value, lengthM) {
  const pieces = positive(value), length = positive(lengthM);
  if (!Number.isSafeInteger(pieces) || !length) return null;
  const total = pieces * Math.round(length * PRECISION);
  return Number.isSafeInteger(total) && total > 0 ? { pieces, metres: total / PRECISION } : null;
}

export function pipeOrderFromMetres(value, lengthM) {
  const metres = positive(value), length = positive(lengthM);
  if (!metres || !length) return null;
  const scaled = Math.round(metres * PRECISION);
  if (!Number.isSafeInteger(scaled) || Math.abs(scaled / PRECISION - metres) > Number.EPSILON * metres) return null;
  return pipeOrderFromPieces(Math.ceil(scaled / Math.round(length * PRECISION)), length);
}

function unitMode(unit) {
  const label = String(unit ?? '').trim().toLowerCase().replace(/[.\s]/g, '');
  if (/^(?:м|мп|погм|метр(?:а|ов)?|m)$/.test(label)) return 'metres';
  if (/^(?:шт|штук(?:а|и)?|хлыст(?:а|ов)?)$/.test(label)) return 'pieces';
  return null;
}

function purchaseName(item) {
  const section = item.assortment?.trim().replace(/^труб[аы]\s*(?=[ø⌀ф\d])/iu, '');
  if (section) return section;
  const { diameter, width, height, thickness } = item.dims || {};
  const dim = value => String(value).replace('.', ',');
  if (thickness > 0 && diameter > 0) return 'Ø' + [diameter, thickness].map(dim).join('×');
  if (thickness > 0 && width > 0 && height > 0) return [width, height, thickness].map(dim).join('×');
  return null;
}

function washState(item) {
  if (typeof item.washed === 'boolean') return item.washed;
  const name = normSearch(item.name);
  if (/(?:^|\s)не\s*мыт(?:ая|ые|ый)(?:$|\s)/u.test(name)) return false;
  if (/(?:^|\s)мыт(?:ая|ые|ый)(?:$|\s)/u.test(name)) return true;
  return null;
}

function pipeMaterial(item) {
  const description = [item.materialGrade, item.name, item.assortment].filter(Boolean).join(' ');
  if (/нерж|stainless|\baisi\s*\d|\d{1,2}х\d{2}н\d/iu.test(description)) return 'Нержавейка';
  if (/алюмин/iu.test(description)) return 'Алюминий';
  if (/медн|медь/iu.test(description)) return 'Медь';
  if (/латун/iu.test(description)) return 'Латунь';
  return 'Сталь';
}

// Группа объединяет складские исполнения одного сортамента с одной длиной и
// единицей закупки. Продолжаем оформлять обычную заявку на конкретный materialId.
export function addPurchasePipe(groups, item, row) {
  if (/(?:^|[\s,–—-])(?:куски|кусок|обрезок)(?:$|[\s,–—-])/iu.test(item.name || '')) return;
  const name = purchaseName(item);
  const lengthM = positive(item.dims?.length) ? Number(item.dims.length) / 1000 : null;
  const mode = unitMode(row.unit);
  const material = pipeMaterial(item);
  const key = JSON.stringify([name ? normSearch(name) : row.materialId, row.type, normSearch(row.grade),
    material, normSearch(item.standardRef), lengthM, mode || row.unit]);
  const wash = washState(item);
  const rank = wash === false ? 0 : wash === null ? 1 : 2;
  let group = groups.get(key);
  if (!group) {
    const pipe = { lengthM, unitMode: mode, material, standard: item.standardRef || '', washedM: 0, unwashedM: 0, unknownM: 0, stockUnknown: false, reservedQty: 0, sourceMaterials: [] };
    group = { row: { ...row, openPurchases: [], name: name || row.name, size: name || row.size, quantity: null, pipe }, rank };
    groups.set(key, group);
  }
  const target = group.row;
  if (row.lastPurchase?.date && (!target.lastPurchase?.date || row.lastPurchase.date > target.lastPurchase.date)) {
    target.lastPurchase = row.lastPurchase;
  }
  target.pipe.reservedQty = Number.isFinite(target.pipe.reservedQty) && Number.isFinite(item.reservedQty)
    ? target.pipe.reservedQty + item.reservedQty : null;
  target.openPurchases.push(...(row.openPurchases || []));
  target.pipe.sourceMaterials.push({ materialId: row.materialId, name: row.name, article: row.article, unit: row.unit });
  if (rank < group.rank || (rank === group.rank && row.materialId < target.materialId)) {
    group.rank = rank;
    Object.assign(target, { materialId: row.materialId, article: row.article, unit: row.unit });
  }
  if (!Number.isFinite(item.quantity)) { target.pipe.stockUnknown = true; return; }
  target.quantity = (target.quantity || 0) + item.quantity;
  if (item.quantity === 0) return;
  const factor = mode === 'metres' ? 1 : mode === 'pieces' ? lengthM : null;
  if (!factor) { target.pipe.stockUnknown = true; return; }
  const field = wash === true ? 'washedM' : wash === false ? 'unwashedM' : 'unknownM';
  target.pipe[field] = Math.round((target.pipe[field] + item.quantity * factor) * PRECISION) / PRECISION;
}

/** Бронь — в единице склада, ожидаемые заказы — в единицах строк поставщика. */
export function pipeCommitments(row) {
  const length = row.pipe.lengthM;
  function totals(lines) {
    let pieces = 0, metres = 0;
    for (const { qty, mode } of lines) {
      if (qty === 0) continue;
      if (!Number.isFinite(qty) || !mode) return { pieces: null, metres: null };
      const n = mode === 'pieces' ? qty : length > 0 ? qty / length : null;
      const m = mode === 'metres' ? qty : length > 0 ? qty * length : null;
      pieces = pieces === null || n === null ? null : pieces + n;
      metres = metres === null || m === null ? null : metres + m;
    }
    return { pieces, metres };
  }
  return {
    reserved: totals([{ qty: row.pipe.reservedQty, mode: row.pipe.unitMode }]),
    ordered: totals(row.openPurchases.filter(line => line.status === 'ordered')
      .map(line => ({ qty: line.qty, mode: unitMode(line.unit || row.unit) }))),
  };
}
