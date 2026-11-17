/**
 * C142 B: состав на листе черновика — прямые дети по словарю.
 * Модуль раскрывается GET /modules/:id/composition (детали не копируются в изделие).
 * Деталь → сырьё: GET /materials/:id/composition. Выпущенный паспорт сюда не ходит.
 */
import { api } from '../../core/api.js';
import { h } from '../../core/dom.js';
import { table as kitTable } from '../../ui/kit/index.js';

const asList = (resp) => (Array.isArray(resp) ? resp : (resp?.items || resp?.composition || []));
const idOf = (v) => {
  if (v == null || v === '') return '';
  if (typeof v === 'object') return String(v.id || v._id || '');
  return String(v);
};
const wordOf = (lineType, kind) => {
  if (lineType === 'module') return 'Модуль';
  if (lineType === 'product') return 'Изделие';
  if (kind === 'part') return 'Деталь';
  if (kind === 'purchased') return 'Покупное';
  if (kind === 'fastener') return 'Метиз';
  if (kind === 'raw') return 'Сырьё';
  return 'Материал';
};

function cached(cache, key, load) {
  if (!cache.has(key)) cache.set(key, Promise.resolve().then(load));
  return cache.get(key);
}

async function nodeFrom(line, depth, cache) {
  const lineType = line.lineType || 'material';
  const ref = idOf(line.refId || line.moduleId || line.materialId || line.productId);
  let name = String(line.name || line.refName || '').trim();
  let article = String(line.article || line.sku || '').trim();
  let kind = line.kind || '';
  let unit = line.unit || 'шт';
  const qty = Number(line.quantity);
  let children = [];
  let note = '';

  if (lineType === 'module' && ref) {
    if (!name) {
      const mod = await cached(cache, 'mod:' + ref, () => api('/modules/' + ref).catch(() => null));
      name = String(mod?.name || '').trim();
      article = article || mod?.article || mod?.sku || '';
    }
    if (depth < 3) {
      let raw = null;
      try { raw = await api('/modules/' + ref + '/composition'); } catch { note = 'состав модуля не загрузился'; }
      if (raw) children = (await Promise.all(asList(raw).map((kid) => nodeFrom(kid, depth + 1, cache)))).filter(Boolean);
      if (raw && !children.length) note = 'внутри нет деталей';
    }
  } else if (lineType === 'product') {
    const nested = Array.isArray(line.children) ? line.children : [];
    if (nested.length && depth < 3) {
      children = (await Promise.all(nested.map((kid) => nodeFrom(kid, depth + 1, cache)))).filter(Boolean);
    }
  } else if (lineType === 'material' && ref) {
    if (!name || !kind) {
      const mat = await cached(cache, 'mat:' + ref, () => api('/materials/' + ref).catch(() => null));
      name = name || String(mat?.name || '').trim();
      article = article || mat?.article || '';
      kind = kind || mat?.materialKind || (mat?.isProfile ? 'raw' : '');
      unit = line.unit || mat?.unit || unit;
    }
    if (kind === 'part' && depth < 3) {
      const raw = await api('/materials/' + ref + '/composition').catch(() => []);
      children = (await Promise.all(asList(raw).map((kid) => nodeFrom({ ...kid, lineType: kid.lineType || 'material' }, depth + 1, cache)))).filter(Boolean);
    }
  }

  const title = name || article || 'Без имени';
  return {
    word: wordOf(lineType, kind),
    name: title,
    article: name && article && article !== name ? article : '',
    qty: Number.isFinite(qty) ? qty : 0,
    unit,
    children,
    note,
  };
}

/** Дерево состава изделия для листа черновика. */
export async function loadCompositionTree(productId) {
  const prod = await api('/showcase/' + productId);
  const cache = new Map();
  const nodes = [];
  for (const line of prod.composition || []) {
    const node = await nodeFrom(line, 0, cache);
    if (node) nodes.push(node);
  }
  return nodes;
}

const numText = (v) => String(v ?? '').replace('.', ',');

function flatRows(nodes, depth, acc) {
  for (const n of nodes) {
    const pad = depth ? '— '.repeat(Math.min(depth, 3)) : '';
    const title = pad + n.name + (n.article ? ' · ' + n.article : '');
    const name = n.note ? title + ' · ' + n.note : title;
    acc.push([n.word, name, numText(n.qty) + ' ' + (n.unit || 'шт')]);
    if (n.children?.length) flatRows(n.children, depth + 1, acc);
  }
  return acc;
}

/** Таблица состава на листе. Пустой список — null. */
export function compositionSheet(lines) {
  const rows = flatRows(lines || [], 0, []);
  if (!rows.length) return null;
  return h('div', { class: 'bk-p' }, kitTable({
    label: 'Состав изделия',
    columns: [{ label: 'Что' }, { label: 'Наименование' }, { label: 'Количество', num: true }],
    rows: rows.map((cells) => ({ cells })),
  }));
}
