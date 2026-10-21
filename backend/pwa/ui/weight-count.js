import { h } from '../core/dom.js';
import { parseNum, qty } from '../core/format.js';

/*
 * «Количество: штуками / по весу» (TASKS НО.1) — один компонент для «Новой позиции», «Прихода», «Пересчитать» и «Операций».
 * По весу — как в листе «Склад»: вес 1 шт. (из карточки или «взвесить образец»: N шт = M г) · партии на весах (+ тара) →
 * ≈ штук = общий вес ÷ вес 1 шт. Склад хранит штуки: компонент пишет результат в поле количества (qtyInput) и шлёт input,
 * а на сервер уходит byWeight — сервер считает сам (backend stock/weight.ts) и пишет расчёт в примечание движения.
 *   const wc = weightCount({ qtyInput, unit: 'шт', unitWeightG: 8, label: 'Количество' });
 *   wc.el · wc.get() → { qty, byWeight? } · wc.mode()
 */
const r2 = (n) => Math.round(n * 100) / 100;
const pos = (n) => Number.isFinite(n) && n > 0;

/** Та же формула, что на сервере (stock/weight.ts weightCount). */
export function calcWeight({ unitWeightG, sampleCount, sampleWeightG, batchesG = [], tareG }) {
  const errors = [];
  let unit = null;
  if (sampleCount !== undefined || sampleWeightG !== undefined) {
    if (!pos(sampleCount)) errors.push('Сколько штук в образце — больше нуля');
    else if (!pos(sampleWeightG)) errors.push('Вес образца — больше нуля');
    else unit = sampleWeightG / sampleCount;
  } else if (pos(unitWeightG)) unit = unitWeightG;
  else errors.push('Нет веса 1 шт. — взвесьте образец');
  const b = batchesG.filter((x) => Number.isFinite(x) && x !== 0);
  if (b.some((x) => x < 0)) errors.push('Вес партии не может быть меньше 0');
  const total = r2(b.reduce((s, x) => s + x, 0) - (pos(tareG) ? tareG : 0));
  if (!b.length) errors.push('Впишите вес хотя бы одной партии');
  else if (total <= 0) errors.push('Тара больше веса партий');
  const exact = unit && total > 0 ? total / unit : null;
  return { unitWeightG: unit === null ? null : r2(unit), totalG: total, exact: exact === null ? null : r2(exact), count: exact === null ? null : Math.round(exact), errors, ok: !errors.length && exact !== null && Math.round(exact) > 0 };
}

const g = (n) => `${qty(r2(n))} г`;

export function weightCount({ qtyInput, unit = 'шт', unitWeightG = null, label = 'Количество', expectQty = null }) {
  const byWeightAllowed = String(unit || 'шт').toLowerCase() === 'шт'; // метры, кг — только количеством (НО.3)
  let mode = 'pcs';
  const segPcs = h('button', { type: 'button', class: 'fseg-btn on', onclick: () => setMode('pcs') }, 'Штуками');
  const segW = h('button', { type: 'button', class: 'fseg-btn', onclick: () => setMode('w') }, 'По весу');
  const seg = byWeightAllowed ? h('div', { class: 'fseg wc-seg', role: 'radiogroup', 'aria-label': 'Как считать' }, segPcs, segW) : null;
  const pcs = h('label', { class: 'field' }, h('span', null, `${label}, ${unit}`), qtyInput);

  // 1. Вес 1 шт.
  const sCount = h('input', { inputmode: 'decimal', placeholder: 'напр. 10' });
  const sWeight = h('input', { inputmode: 'decimal', placeholder: 'напр. 80' });
  const knownLine = h('div', { class: 'wc-known' });
  let useSample = !pos(unitWeightG);
  const sampleBox = h('div', { class: 'wc-grid' }, h('label', { class: 'field' }, h('span', null, 'Штук в образце'), sCount), h('label', { class: 'field' }, h('span', null, 'Вес образца, г'), sWeight));
  const unitOut = h('div', { class: 'wc-sub' });
  const saveBox = h('label', { class: 'wc-save', hidden: true }, h('input', { type: 'checkbox' }), ' сохранить новый вес 1 шт. в карточку');
  // 2. Партии
  const batches = h('div', { class: 'wc-batches' });
  const tare = h('input', { inputmode: 'decimal', placeholder: 'необязательно' });
  const addBatch = (focus) => {
    const n = batches.children.length + 1;
    const inp = h('input', { inputmode: 'decimal', placeholder: 'вес, г' });
    inp.addEventListener('input', recalc);
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addBatch(true); } });
    batches.append(h('label', { class: 'field' }, h('span', null, `Партия ${n}, г`), inp));
    if (focus) inp.focus();
  };
  // 3. Результат
  const result = h('div', { class: 'wc-result' });
  const wBox = h('div', { class: 'wc-weight', hidden: true },
    h('div', { class: 'wc-step' }, h('b', null, '1. Вес 1 шт.'), knownLine, sampleBox, unitOut, saveBox),
    h('div', { class: 'wc-step' }, h('b', null, '2. Вес партий'), h('div', { class: 'wc-sub' }, 'Весы вмещают не всё — взвесьте по частям; Enter — следующая партия'), batches,
      h('div', { class: 'wc-grid' }, h('button', { type: 'button', class: 'btn btn-sm', onclick: () => addBatch(true) }, '+ партия'), h('label', { class: 'field' }, h('span', null, 'Тара / ящик, г'), tare))),
    result);
  const el = h('div', { class: 'wc field wide' }, seg, pcs, wBox);

  function renderKnown() {
    knownLine.replaceChildren(pos(unitWeightG)
      ? h('span', null, `Из карточки: ${g(unitWeightG)} `, h('button', { type: 'button', class: 'link-btn', onclick: () => { useSample = !useSample; renderKnown(); recalc(); } }, useSample ? 'взять из карточки' : 'взвесить образец'))
      : h('span', { class: 'wc-sub' }, 'Веса 1 шт. в карточке нет — взвесьте образец (10 шт и больше — точнее)'));
    sampleBox.hidden = !useSample;
  }
  function input() {
    const batchesG = [...batches.querySelectorAll('input')].map((i) => parseNum(i.value)).filter((x) => x !== undefined);
    return { ...(useSample ? { sampleCount: parseNum(sCount.value), sampleWeightG: parseNum(sWeight.value) } : { unitWeightG }), batchesG, ...(parseNum(tare.value) ? { tareG: parseNum(tare.value) } : {}) };
  }
  let last = null;
  function recalc() {
    if (mode !== 'w') return;
    const w = input();
    const touched = w.batchesG.length || (useSample && (sCount.value || sWeight.value));
    last = calcWeight(w);
    unitOut.textContent = useSample && last.unitWeightG ? `Вес 1 шт. = ${g(last.unitWeightG)}${pos(w.sampleCount) && w.sampleCount < 10 ? ' — образец меньше 10 шт, точность ниже' : ''}` : '';
    const differs = useSample && pos(unitWeightG) && last.unitWeightG && Math.abs(last.unitWeightG - unitWeightG) / unitWeightG > 0.1;
    saveBox.hidden = !differs;
    if (last.ok) {
      const off = expectQty > 0 && Math.abs(last.count - expectQty) / expectQty > 0.3;
      result.className = 'wc-result ok' + (off ? ' warn' : '');
      result.replaceChildren(...[h('div', { class: 'wc-big' }, `≈ ${qty(last.count)} шт`), h('div', { class: 'wc-sub' }, `${g(last.totalG)} ÷ ${g(last.unitWeightG)}${last.exact !== last.count ? ` = ${qty(last.exact)} → округлено` : ''}`),
        off ? h('div', { class: 'wc-warn' }, `Сильно отличается от учёта (${qty(expectQty)} шт) — проверьте вес 1 шт. и партии`) : null].filter(Boolean));
      qtyInput.value = String(last.count);
    } else {
      result.className = 'wc-result';
      result.replaceChildren(h('div', { class: 'wc-sub' }, touched ? last.errors[0] : 'Впишите вес — штуки посчитаются сами'));
      qtyInput.value = '';
    }
    qtyInput.dispatchEvent(new Event('input', { bubbles: true }));
  }
  function setMode(m) {
    mode = m;
    segPcs.classList.toggle('on', m === 'pcs'); segW.classList.toggle('on', m === 'w');
    wBox.hidden = m !== 'w';
    qtyInput.readOnly = m === 'w';
    pcs.querySelector('span').textContent = m === 'w' ? `${label} — посчитано по весу, ${unit}` : `${label}, ${unit}`;
    if (m === 'w') { if (!batches.children.length) addBatch(false); renderKnown(); recalc(); }
  }
  for (const i of [sCount, sWeight, tare]) i.addEventListener('input', recalc);
  return {
    el,
    mode: () => mode,
    /** { qty, byWeight? } — byWeight уходит на сервер (он посчитает сам), qty — для предпросмотра. */
    get() {
      if (mode !== 'w') return { qty: parseNum(qtyInput.value) };
      return { qty: last?.ok ? last.count : undefined, byWeight: { ...input(), ...(saveBox.querySelector('input').checked ? { saveUnitWeight: true } : {}) }, errors: last?.errors || [] };
    },
  };
}
