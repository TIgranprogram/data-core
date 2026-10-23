import { api, PREFIX } from '../core/api.js';
import { h } from '../core/dom.js';
import { normSearch, searchTokens } from '../core/facets.js';
import { money, parseNum, qty } from '../core/format.js';

/*
 * «Состав изделия» (TASKS БЗ-5, СИ) — правая панель: из чего состоит изделие — материалы склада и другие изделия
 * «Продукции» (модули CRM — показываются, если есть, и сохраняются как были). Открывается из карточки «Продукции»
 * («Изменить состав»); сервер — PUT /api/showcase/:id/composition { lines, types }, изделие внутри самого себя — 400.
 * Строки — по разделам («Материалы со склада», «Изделия»): количество со степпером, цена и сумма (если известна), «×».
 * «Добавить» — один список с поиском «как на складе», по разделам: материалы по категориям склада, изделия по
 * «Раздел › Группа»; сверху — «Часто в похожих изделиях» (составы изделий той же группы); чипы Все · Материалы · Изделия.
 */
let target = null;
export const setCompositionTarget = (row) => { target = row; };

const GROUPS = { material: 'Материалы со склада', product: 'Изделия', module: 'Модули (из CRM)' };
const keyOf = (l) => `${l.lineType}:${l.refId}`;

async function buildCompositionForm() {
  if (!target) throw new Error('Откройте изделие и нажмите «Изменить состав»');
  const prod = target;
  const [stock, products, similar] = await Promise.all([
    api('/stock/items', { query: { limit: 10000 } }).then((r) => r.items || []).catch(() => []),
    api('/showcase', { query: { limit: 500 } }).then((r) => r.items || []).catch(() => []),
    api(`/showcase/${prod.id}/composition/similar`).then((r) => r.items || []).catch(() => []),
  ]);
  const price = new Map((prod.cost?.lines || []).map((x) => [`${x.lineType || 'material'}:${x.refId || x.materialId}`, x]));
  // строки состава: известные типы правятся; модули и строки CRM — только показ, сохраняются как были
  const rows = (prod.composition || []).map((l) => ({ lineType: l.lineType || 'material', refId: l.refId || l.materialId, name: l.name, article: l.article, unit: l.unit || 'шт',
    quantity: String(l.quantity), notes: l.notes || '', readOnly: !['material', 'product'].includes(l.lineType || 'material'), missing: !!l.missing }));

  const listEl = h('div', { class: 'comp-lines' });
  const totalEl = h('div', { class: 'comp-total' });
  const sumOf = (r) => { const p = price.get(keyOf(r)); const q = parseNum(r.quantity); return p?.price != null && q > 0 ? Math.round(p.price * q * 100) / 100 : null; };
  const drawTotal = () => {
    const edit = rows.filter((r) => !r.readOnly);
    const known = edit.map(sumOf);
    const total = known.reduce((s, x) => s + (x ?? 0), 0);
    const noPrice = known.filter((x) => x == null).length;
    totalEl.replaceChildren(h('span', null, `Позиций: ${qty(rows.length)}`),
      h('span', null, `Себестоимость ≈ ${money(total)}`),
      noPrice ? h('span', { class: 'muted' }, `без цены: ${noPrice}${edit.some((r) => !price.has(keyOf(r))) ? ' (у новых строк цена появится после сохранения)' : ''}`) : null);
  };
  const row = (r) => {
    const q = h('input', { type: 'text', inputmode: 'decimal', value: r.quantity, 'aria-label': `Количество: ${r.name}`, disabled: r.readOnly });
    const sumEl = h('span', { class: 'comp-sum' });
    const paint = () => { const p = price.get(keyOf(r)); const s = sumOf(r); sumEl.textContent = p?.price != null ? `${money(p.price)}/${r.unit}${s != null ? ' · ' + money(s) : ''}` : r.readOnly ? '' : 'цены нет'; };
    const step = (d) => { const v = Math.max(0, Math.round(((parseNum(q.value) || 0) + d) * 1000) / 1000); q.value = String(v).replace('.', ','); r.quantity = q.value; paint(); drawTotal(); };
    q.addEventListener('input', () => { r.quantity = q.value; paint(); drawTotal(); });
    paint();
    return h('div', { class: 'comp-row' + (r.missing ? ' comp-missing' : '') },
      h('div', { class: 'c-name' }, r.name, h('small', null, [r.article && 'арт. ' + r.article, r.missing && 'удалено из справочника — уберите или замените', r.readOnly && 'из CRM, здесь не правится'].filter(Boolean).join(' · '))),
      h('span', { class: 'comp-qty' },
        r.readOnly ? null : h('button', { type: 'button', class: 'btn btn-sm btn-icon', 'aria-label': 'Меньше', onclick: () => step(-1) }, '−'),
        q, r.readOnly ? null : h('button', { type: 'button', class: 'btn btn-sm btn-icon', 'aria-label': 'Больше', onclick: () => step(1) }, '+'),
        h('span', { class: 'muted' }, r.unit)),
      sumEl,
      r.readOnly ? h('span') : h('button', { type: 'button', class: 'btn btn-ghost btn-sm btn-icon', title: 'Убрать из состава', 'aria-label': `Убрать: ${r.name}`, onclick: () => { rows.splice(rows.indexOf(r), 1); draw(); } }, '×'));
  };
  function draw() {
    const parts = [];
    for (const t of Object.keys(GROUPS)) {
      const list = rows.filter((r) => r.lineType === t || (t === 'module' && !GROUPS[r.lineType]));
      if (!list.length) continue;
      parts.push(h('div', { class: 'comp-group' }, h('div', { class: 'section-title' }, `${GROUPS[t]} (${list.length})`), ...list.map(row)));
    }
    listEl.replaceChildren(...(parts.length ? parts : [h('p', { class: 'muted' }, 'Состав пока пуст — добавьте материалы со склада или изделия ниже')]));
    drawTotal();
  }
  const add = (lineType, item) => {
    const ex = rows.find((r) => r.lineType === lineType && r.refId === item.id);
    if (ex) { ex.quantity = String((parseNum(ex.quantity) || 0) + 1).replace('.', ','); draw(); return; }
    rows.push({ lineType, refId: item.id, name: item.name, article: item.article || item.sku || '', unit: item.unit || 'шт', quantity: '1', notes: '' });
    draw();
  };

  // ── «Добавить»: чипы, поиск, список по разделам ──
  let kind = 'all'; let query = '';
  const chips = h('div', { class: 'chips', role: 'tablist', 'aria-label': 'Что добавить' });
  const input = h('input', { type: 'text', placeholder: 'Найти: название или артикул (м10 = M10, слова в любом порядке)', 'aria-label': 'Найти, что добавить', autocomplete: 'off' });
  const pick = h('ul', { class: 'pick-list', role: 'listbox', 'aria-label': 'Материалы и изделия' });
  const mats = stock.map((s) => ({ id: s.materialId || s.id, name: s.name, article: s.article, unit: s.unit, group: s.categoryName || 'Без категории', sub: [s.article && 'арт. ' + s.article, `на складе: ${qty(s.free ?? s.quantity ?? 0)} ${s.unit || ''}`].filter(Boolean).join(' · '), lineType: 'material' }));
  const prods = products.filter((p) => p.id !== prod.id) // само в себя — нельзя (глубже проверит сервер)
    .map((p) => ({ id: p.id, name: p.name, sku: p.sku, unit: p.unit || 'шт', photo: p.photo, group: [p.type, p.group].filter(Boolean).join(' › ') || 'Без раздела', sub: [p.sku && 'арт. ' + p.sku, p.price ? money(p.price) : ''].filter(Boolean).join(' · '), lineType: 'product' }));
  const drawChips = () => chips.replaceChildren(...[['all', 'Все'], ['material', 'Материалы'], ['product', 'Изделия']].map(([v, l]) => h('button', { type: 'button', role: 'tab', class: 'chip' + (kind === v ? ' active' : ''), 'aria-selected': String(kind === v), onclick: () => { kind = v; drawChips(); drawPick(); } }, l)));
  function drawPick() {
    const tk = searchTokens(query);
    const take = (list) => list.filter((x) => !tk.length || ((s) => tk.every((t) => s.includes(t)))(normSearch([x.name, x.article, x.sku, x.group].filter(Boolean).join(' '))));
    const sections = [];
    if (kind !== 'product') sections.push([GROUPS.material, take(mats)]);
    if (kind !== 'material') sections.push([GROUPS.product, take(prods)]);
    const out = []; let shown = 0;
    for (const [title, list] of sections) {
      if (!list.length) continue;
      out.push(h('li', { class: 'pick-head' }, `${title} · ${qty(list.length)}`));
      const by = new Map(); for (const x of list) { if (!by.has(x.group)) by.set(x.group, []); by.get(x.group).push(x); }
      for (const [g, items] of [...by].sort((a, b) => a[0].localeCompare(b[0], 'ru'))) {
        if (shown >= 80) break;
        out.push(h('li', { class: 'combo-group' }, g));
        for (const x of items.slice(0, Math.max(0, 80 - shown))) {
          shown++;
          const have = rows.some((r) => r.lineType === x.lineType && r.refId === x.id);
          out.push(h('li', { class: 'sg-row' + (x.lineType === 'product' ? ' sg-pic-row' : ''), role: 'option', tabindex: '0', onclick: () => add(x.lineType, x), onkeydown: (e) => { if (e.key === 'Enter') add(x.lineType, x); } },
            x.lineType === 'product' ? (x.photo ? h('img', { class: 'sg-pic', src: PREFIX + (x.photo.thumb || x.photo.url), alt: '' }) : h('div', { class: 'sg-pic sg-pic-none' })) : null,
            h('div', null, h('div', { class: 'opt-l' }, x.name, have ? h('span', { class: 'muted' }, ' · уже в составе (+1)') : null), x.sub ? h('small', null, x.sub) : null)));
        }
      }
    }
    const total = sections.reduce((s, [, l]) => s + l.length, 0);
    if (total > shown) out.push(h('li', { class: 'sg-row muted static' }, `ещё ${qty(total - shown)} — уточните поиск`));
    pick.replaceChildren(...(out.length ? out : [h('li', { class: 'sg-row muted static' }, query ? `По «${query}» ничего не найдено` : 'Список пуст')]));
  }
  let tm; input.addEventListener('input', () => { query = input.value; clearTimeout(tm); tm = setTimeout(drawPick, 150); });
  // «Часто в похожих изделиях» — метками, клик добавляет
  const often = similar.length ? h('div', null, h('div', { class: 'hint' }, 'Часто в похожих изделиях этой группы:'),
    h('div', { class: 'tag-pick' }, ...similar.map((s) => h('button', { type: 'button', class: 'tag', title: `в ${s.n} изд.`, onclick: () => add(s.lineType, { id: s.refId, name: s.name, unit: s.unit }) }, s.name, h('small', null, `${s.lineType === 'product' ? 'изделие' : 'материал'} · в ${s.n}`))))) : null;

  draw(); drawChips(); drawPick();
  const el = h('div', null,
    h('p', { class: 'hint' }, `Изделие «${prod.name}»: из чего оно состоит. Количество — на одно изделие. Позиции заказов от этого не меняются.`),
    listEl, totalEl,
    h('div', { class: 'section-title' }, 'Добавить'), often, chips, input, pick);
  return {
    el, focus: () => input.focus(), dirty: () => true,
    read: () => ({ values: { save: async () => {
      const edit = rows.filter((r) => !r.readOnly);
      const lines = edit.map((r) => ({ lineType: r.lineType, [r.lineType === 'product' ? 'productId' : 'materialId']: r.refId, quantity: parseNum(r.quantity), notes: r.notes }));
      if (lines.some((l) => !(l.quantity > 0))) throw new Error('Укажите количество больше нуля у каждой строки (или уберите строку «×»)');
      if (edit.some((r) => r.missing)) throw new Error('В составе есть удалённые позиции — уберите их «×» или замените');
      return api(`/showcase/${prod.id}/composition`, { method: 'PUT', body: { lines, types: ['material', 'product'] } });
    } } }),
  };
}

export const composition = {
  id: 'composition', title: 'Состав изделия', newTitle: 'Состав изделия', card: { heading: () => 'Состав' }, get: async () => ({}),
  form: { build: buildCompositionForm, toBody: (v) => v, create: (v) => v.save(), saveLabel: 'Сохранить состав', closeAfterCreate: true },
};
