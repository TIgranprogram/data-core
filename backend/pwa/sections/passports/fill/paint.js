import { PREFIX } from '../../../core/api.js';
import { h } from '../../../core/dom.js';
import { actions, badge, button, hint, link, row, stack } from '../../../ui/kit/index.js';
import { passportSlot } from '../../product-files.js';
import {
  controlGap, dimsEditor, elementsEditor, installEditor, jointsEditor, kitEditor, materialsEditor, numEditor, suggestRow, weightEditor,
} from './control.js';
import { OPS, PLACE, boxOf, dimText, elText, gapLabel, gapSection, instText, jointsLine, kitText, matText, opText, slotKinds } from './model.js';

const href = (u) => (!u ? '' : (String(u).startsWith('http') || String(u).startsWith(PREFIX) ? u : PREFIX + u));

function gapOf(spec, missing) {
  return missing.find((m) => {
    if (m.kind === 'image') return false;
    if (String(m.key || '') === spec.key) return true;
    if (spec.key === 'elements' && m.kind === 'elements') return true;
    if (spec.key === 'installationTypeId' && m.kind === 'install') return true;
    if (spec.key === 'weight' && (m.key === 'weight' || m.key === 'weightKg')) return true;
    return false;
  });
}

/** filled — строка «Подпись: значение ✎»; open — поле; skip — способ установки уже выбран текстом. Пустое открыто в обоих режимах. */
function decide(ctx, spec, gap, text) {
  if (spec.key === 'installationTypeId' && ctx.covered) return 'skip';
  if (spec.key === 'materials') return 'open';
  if (ctx.editing.has(spec.key)) return 'open';
  if (text && !gap) return 'filled';
  return 'open';
}

function scalars(ctx) {
  const numAt = (key, label, unit) => ({
    key, section: key === 'maxUsers' ? 'general' : 'ops', label, ask: 'template', unit,
    text: opText(ctx.prod, key, unit),
    editor: (gap) => numEditor(ctx, key, unit ? `${label}, ${unit}` : label, gap?.default),
  });
  return [
    numAt('maxUsers', 'Пользователей одновременно', ''),
    { key: 'elements', section: 'purpose', label: 'Что это за изделие', ask: 'both', text: elText(ctx.prod, ctx.elNames), editor: (gap) => elementsEditor(ctx, gap) },
    { key: 'height', section: 'dims', label: 'Габариты', ask: 'template', text: dimText(ctx.prod), editor: () => dimsEditor(ctx) },
    { key: 'weight', section: 'dims', label: 'Вес', ask: 'template', text: ctx.prod.weightKg ? `${ctx.prod.weightKg} кг` : '', editor: () => weightEditor(ctx) },
    { key: 'joints', section: 'struct', label: 'Как соединено', ask: 'both', text: jointsLine(ctx.prod), editor: () => jointsEditor(ctx) },
    { key: 'isKit', section: 'struct', label: 'Как поставляется', ask: 'both', text: kitText(ctx.prod), editor: () => kitEditor(ctx) },
    { key: 'materials', section: 'struct', label: 'Из чего сделано', ask: 'both', text: matText(ctx.prod), editor: () => materialsEditor(ctx) },
    { key: 'installationTypeId', section: 'install', label: 'Способ установки', ask: 'template', text: instText(ctx.prod, ctx.instNames), editor: (gap) => installEditor(ctx, gap) },
    ...OPS.map(([key, label, unit]) => numAt(key, label, unit)),
  ];
}

function filledLink(ctx, spec, text) {
  return link({ label: `${spec.label}: ${text} ✎`, title: 'Изменить', onClick: () => { ctx.editing.add(spec.key); ctx.repaint(); } });
}

/** Поля разделов: пустое открыто, заполненное — строка. В режиме issue заполненное прячется в одну строку сверху. */
export function paintFields(ctx) {
  ctx.filled = [];
  const used = new Set();
  for (const host of Object.values(ctx.fieldHost)) host.replaceChildren();
  const showRow = ctx.mode === 'template' || ctx.reveal;
  for (const spec of scalars(ctx)) {
    const gap = gapOf(spec, ctx.missing);
    if (gap) used.add(gap.key);
    const text = spec.text;
    const state = decide(ctx, spec, gap, text);
    if (state === 'skip') continue;
    const host = ctx.fieldHost[spec.section];
    if (state === 'filled') {
      ctx.filled.push(spec.key);
      if (showRow) host.append(h('div', { dataset: { gap: spec.key } }, filledLink(ctx, spec, text)));
    } else host.append(h('div', { dataset: { gap: spec.key } }, spec.editor(gap)));
  }
  for (const m of ctx.missing) {
    if (m.kind === 'image' || m.kind === 'category' || used.has(m.key)) continue;
    const node = controlGap(m, ctx);
    if (node) ctx.fieldHost[gapSection(m)].append(h('div', { dataset: { gap: String(m.key) } }, node));
  }
  const elOpen = ctx.editing.has('elements') || ctx.missing.some((m) => m.kind === 'elements' || m.key === 'elements');
  if (ctx.mode === 'template' || ctx.reveal || elOpen) ctx.fieldHost.purpose.append(ctx.elSec);
  ctx.els.setIds(ctx.prod.passportDefaults?.elements || []);
  const catGap = ctx.missing.find((m) => m.kind === 'category');
  const suggest = catGap && suggestRow(catGap, (v) => ctx.onCategory(v), (job) => job());
  ctx.catSuggest.replaceChildren(suggest || null);
}

/** Слоты рисунков. В режиме issue уже загруженный рисунок входит в «Уже заполнено» и скрыт, пока строку не раскроют. */
export function paintSlots(ctx) {
  for (const host of Object.values(ctx.slotHost)) host.replaceChildren();
  if (!ctx.code) {
    ctx.slotHost.general.replaceChildren(hint('Сначала выберите категорию паспорта'));
    ctx.photoFilled = 0;
    return;
  }
  const kit = ctx.prod.passportDefaults?.isKit === true;
  const kinds = slotKinds(ctx.asked, ctx.byKind, ctx.full, kit);
  const buckets = {};
  let photos = 0;
  for (const k of kinds) {
    const has = ctx.byKind.has(k);
    if (has) photos++;
    if (has && ctx.mode === 'issue' && !ctx.reveal && k !== 'assembly') continue;
    const node = passportSlot({
      productId: ctx.prod.id, kind: k, rec: ctx.byKind.get(k), canEdit: ctx.can,
      required: ctx.asked.has(k) && !has, onChange: () => ctx.reload(),
    });
    node.dataset.gap = 'img_' + k;
    (buckets[PLACE[k]] ||= []).push(node);
  }
  for (const [id, nodes] of Object.entries(buckets)) ctx.slotHost[id].replaceChildren(h('div', { class: 'pp-slots' }, ...nodes));
  const pdm = (kind, title) => {
    const file = (ctx.pdm || []).find((f) => f.docKind === kind && f.url);
    return file ? button({ label: 'Взять из PDM', size: 'S', title, onClick: () => window.open(href(file.url), '_blank', 'noopener') }) : null;
  };
  const extra = [pdm('assembly', 'Сборочный чертёж из PDM'), ctx.unnamed ? hint('У детали нет названия', 'warn') : null];
  if (extra.some(Boolean)) ctx.slotHost.dims.append(...extra);
  const inst = pdm('install', 'Схема установки из PDM');
  if (inst) ctx.slotHost.install.append(inst);
  ctx.photoFilled = photos;
}

function textDone(ctx) {
  let n = 0;
  for (const host of Object.values(ctx.textHost)) {
    for (const node of host.children) {
      const done = !!node.querySelector?.('.pp-step-sum');
      node.hidden = ctx.mode === 'issue' && !ctx.reveal && done;
      if (done) n++;
    }
  }
  return n;
}

function focusGap(ctx, m) {
  const key = String(m.key || '');
  const n = [...ctx.root.querySelectorAll('[data-gap]')].find((el) => el.dataset.gap === key);
  (n || ctx.secs[gapSection(m)])?.scrollIntoView({ block: 'start' });
}

/** Полоса «Готово N из M», подписи разделов и строка «Уже заполнено». */
export function syncChrome(ctx) {
  const done = (ctx.filled?.length || 0) + textDone(ctx) + (ctx.photoFilled || 0);
  const miss = ctx.missing.length;
  const kitOn = ctx.prod.passportDefaults?.isKit === true;
  const asm = ctx.asked.has('assembly') || ctx.byKind.has('assembly');
  for (const [id, sec] of Object.entries(ctx.secs)) {
    const hosts = [ctx.fieldHost[id], ctx.textHost[id], ctx.slotHost[id]];
    const has = hosts.some((host) => [...host.childNodes].some((n) => !n.hidden));
    if (id === 'other') sec.hidden = !has;
    else if (id === 'assembly') sec.hidden = !(kitOn || asm);
    else if (ctx.mode === 'issue') sec.hidden = !has;
    else sec.hidden = false;
  }
  if (!ctx.code) ctx.strip.replaceChildren(hint('Сначала выберите категорию паспорта', 'warn'));
  else if (!miss) ctx.strip.replaceChildren(badge('Паспорт можно выпускать', 'ok'));
  else {
    const chips = ctx.missing.slice(0, 12).map((m) => button({
      label: gapLabel(m), kind: 'ghost', title: 'Перейти к полю', onClick: () => focusGap(ctx, m),
    }));
    ctx.strip.replaceChildren(stack(
      row({ title: `Готово ${done} из ${done + miss}`, tone: 'info' }),
      actions(...chips),
    ));
  }
  const summaryN = done;
  if (ctx.mode === 'issue' && summaryN) {
    ctx.summary.replaceChildren(link({
      label: ctx.reveal ? 'Скрыть заполненное' : `Уже заполнено: ${summaryN} ✎ (раскрыть)`,
      title: 'Показать, что уже записано в изделии',
      onClick: () => { ctx.reveal = !ctx.reveal; ctx.repaint(); },
    }));
  } else ctx.summary.replaceChildren();
  ctx.onStatus?.({ required: ctx.missing.filter((m) => m.required) });
}

export function placeTexts(ctx, list) {
  const rootId = String((ctx.missing || []).find((m) => m.kind === 'purpose')?.key || '').replace(/^choice:/, '');
  for (const host of Object.values(ctx.textHost)) host.replaceChildren();
  for (const s of list || []) {
    const node = ctx.fb.stepEl(s.id);
    if (!node) continue;
    node.hidden = !!(rootId && String(s.id) === rootId);
    ctx.textHost[boxOf(s)].append(node);
  }
}
