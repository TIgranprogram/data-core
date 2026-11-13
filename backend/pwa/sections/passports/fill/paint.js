import { PREFIX, api } from '../../../core/api.js';
import { h } from '../../../core/dom.js';
import { actions, badge, button, fieldRow, hint, link, row, section as kitSection, stack, toastError } from '../../../ui/kit/index.js';
import { passportSlot } from '../../product-files.js';
import { modulesEditor, modulesSummary } from '../modules.js';
import {
  controlGap, dimsEditor, elementsEditor, installEditor, jointsEditor, kitEditor, materialsEditor, kindEditor, numEditor, weightEditor,
} from './control.js';
import { OPS, PLACE, boxOf, dimText, elText, gapLabel, gapSection, imageKind, instText, jointsLine, kitText, matText, opText, slotKinds } from './model.js';

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

/**
 * Состояние поля (C086): filled — строка «Подпись: значение ✎»; open — поле; later — применимо, но необязательно и пусто
 * (при выпуске свёрнуто в «Необязательное»); foreign — сохранено, но к изделию не относится; skip — не показывать.
 * Применимость приходит с сервера (`applicable`); её нет — тип паспорта не задан или сервер старый, тогда всё применимо.
 */
export function decide(ctx, spec, gap, text) {
  // сервер назвал поле недостающим (обязательное по категории или подстановка в тексте изделия) — оно применимо без оговорок
  const applies = gap ? 'required' : appliesOf(ctx.applicable, spec);
  if (applies === 'na') return text ? 'foreign' : 'skip';
  if (spec.key === 'installationTypeId' && ctx.covered) return 'skip';
  if (spec.key === 'materials') return 'open';
  if (ctx.editing.has(spec.key)) return 'open';
  if (text && !gap) return 'filled';
  if (!gap && applies === 'optional' && ctx.mode === 'issue' && !ctx.more) return 'later';
  return 'open';
}

/** required | optional | na — по правилам сервера: числа, элементы и «как поставляется» зависят от типа паспорта и назначения. */
export function appliesOf(applicable, spec) {
  if (!applicable) return 'required';
  if (spec.key === 'elements') return applicable.elements || 'required';
  if (spec.key === 'isKit') return applicable.kit || 'optional';
  if (spec.key === 'kind') return 'optional';
  if (spec.key === 'joints') return 'optional';
  if (spec.key === 'foundationDepth') return 'optional'; // глубина Г — для любого типа, необязательна (пишет iLogic)
  if (spec.num) return applicable.fields?.[spec.key] || 'na';
  return 'required';
}

function scalars(ctx) {
  const numAt = (key, label, unit) => ({
    key, section: key === 'maxUsers' ? 'general' : key === 'foundationDepth' ? 'install' : 'ops', label, ask: 'template', unit, num: true,
    text: opText(ctx.prod, key, unit),
    editor: (gap) => numEditor(ctx, key, unit ? `${label}, ${unit}` : label, gap?.default, gap?.defaulted === true),
  });
  return [
    { key: 'kind', section: 'purpose', label: 'Вид изделия', ask: 'both', text: ctx.kind?.name || '', note: kindNote(ctx), editor: (gap) => kindEditor(ctx, gap) },
    numAt('maxUsers', 'Пользователей одновременно', ''),
    numAt('foundationDepth', 'Глубина Г (от земли до низа опоры)', 'мм'),
    { key: 'elements', section: 'purpose', label: 'Что это за изделие', ask: 'both', text: elText(ctx.prod, ctx.elNames) || kindElText(ctx), note: kindElNote(ctx), editor: (gap) => elementsEditor(ctx, gap) },
    { key: 'height', section: 'dims', label: 'Габариты', ask: 'template', text: dimText(ctx.prod), editor: () => dimsEditor(ctx) },
    { key: 'weight', section: 'dims', label: 'Вес', ask: 'template', text: ctx.prod.weightKg ? `${ctx.prod.weightKg} кг` : '', editor: () => weightEditor(ctx) },
    { key: 'joints', section: 'struct', label: 'Как соединено', ask: 'both', text: jointsLine(ctx.prod), editor: () => jointsEditor(ctx) },
    { key: 'isKit', section: 'struct', label: 'Как поставляется', ask: 'both', text: kitText(ctx.prod), editor: () => kitEditor(ctx) },
    { key: 'materials', section: 'struct', label: 'Материалы', ask: 'both', text: matText(ctx.prod), editor: () => materialsEditor(ctx) },
    { key: 'installationTypeId', section: 'install', label: 'Способ установки', ask: 'template', text: instText(ctx.prod, ctx.instNames), editor: (gap) => installEditor(ctx, gap) },
    ...OPS.map(([key, label, unit]) => numAt(key, label, unit)),
  ];
}

function filledLink(ctx, spec, text) {
  const a = link({ label: `${spec.label}: ${text} ✎`, title: 'Изменить', onClick: () => { ctx.editing.add(spec.key); ctx.repaint(); } });
  return spec.note ? h('div', null, a, hint(spec.note)) : a; // подпись источника — вплотную к строке (дизайнер C100)
}

/** Откуда вид: «из группы «…»» или «своё» (C100). */
function kindNote(ctx) {
  const k = ctx.kind;
  if (!k) return '';
  const src = k.source === 'group' ? `из группы «${k.groupName || 'изделия'}»` : 'своё';
  return src; // назначение вида показывает свой шаг ниже — не дублировать
}
const ownElements = (ctx) => (ctx.prod.passportDefaults?.elements || []).length > 0;
function kindElText(ctx) {
  if (ownElements(ctx) || !ctx.kind) return '';
  const kr = (ctx.kindRows || []).find((d) => String(d.id || d._id) === String(ctx.kind.id));
  return (kr?.elementIds || []).map((id) => ctx.elNames.get(String(id)) || '').filter(Boolean).join(', ');
}
const kindElNote = (ctx) => (!ownElements(ctx) && kindElText(ctx) ? `из вида «${ctx.kind.name}»` : '');

/** Поля разделов: пустое открыто, заполненное — строка. В режиме issue заполненное прячется в одну строку сверху. */
export function paintFields(ctx) {
  ctx.filled = [];
  ctx.later = [];
  const used = new Set();
  for (const host of Object.values(ctx.fieldHost)) host.replaceChildren();
  const showRow = ctx.mode === 'template' || ctx.reveal;
  const nums = {}; // короткие числа раздела — одним рядом, а не колонкой на всю ширину
  // заполненное — спокойный зелёный фон, обязательное незаполненное — золотая рамка (пользователь 2026-11-13)
  const wrap = (spec, node, cls) => h('div', { dataset: { gap: spec.key }, class: cls || null }, node);
  for (const spec of scalars(ctx)) {
    const gap = gapOf(spec, ctx.missing);
    if (gap) used.add(gap.key);
    const text = spec.text;
    const state = decide(ctx, spec, gap, text);
    if (state === 'skip') continue;
    if (state === 'later') { ctx.later.push(spec.label); continue; }
    const host = ctx.fieldHost[spec.section];
    if (state === 'foreign') {
      if (showRow) host.append(wrap(spec, hint(`${spec.label}: ${text} — в паспорт этого типа не входит. Значение сохранено в изделии, в паспорт не печатается.`)));
    } else if (state === 'filled') {
      ctx.filled.push(spec.key);
      if (showRow) host.append(wrap(spec, filledLink(ctx, spec, text), 'k-fill-done'));
    } else if (spec.num) (nums[spec.section] ||= []).push(wrap(spec, spec.editor(gap), gap?.required && !gap.defaulted ? 'k-fill-need' : ''));
    else host.append(wrap(spec, spec.editor(gap), gap?.required && !gap.defaulted ? 'k-fill-need' : ''));
  }
  for (const m of ctx.missing) {
    if (m.kind === 'image' || m.kind === 'category' || used.has(m.key)) continue;
    // «Назначение» как обязательное поле и уточнение назначения — один вопрос, а не два
    if (m.key === 'purpose' && ctx.missing.some((x) => x.kind === 'purpose')) continue;
    // необязательный признак без подсказки при выпуске не спрашиваем: он в «Необязательном»
    if (m.kind === 'facet' && !m.required && ctx.mode === 'issue' && !ctx.more) { ctx.later.push(m.label || 'признак'); continue; }
    const node = controlGap(m, ctx);
    if (!node) continue;
    const box = h('div', { dataset: { gap: String(m.key) }, class: m.required ? 'k-fill-need' : null }, node);
    if (m.kind === 'field' && node.classList?.contains('k-ti')) (nums[gapSection(m)] ||= []).push(box);
    else ctx.fieldHost[gapSection(m)].append(box);
  }
  if (ctx.mode === 'template') {
    const modules = ctx.prod.passportDefaults?.modules || [];
    const spec = { key: 'modules', label: 'Модули' };
    if (modules.length && !ctx.editing.has(spec.key) && !ctx.modulesEditor) {
      ctx.fieldHost.general.append(wrap(spec, filledLink(ctx, spec, modulesSummary(modules)), 'k-fill-done'));
    } else {
      if (!ctx.modulesEditor) {
        ctx.modulesEditor = modulesEditor({
          value: modules, productId: () => ctx.prod.id, canEdit: ctx.can,
          save: ctx.saveModules,
          onDone: () => { ctx.modulesEditor = null; ctx.editing.delete(spec.key); ctx.repaint(); },
        });
        ctx.modulesEditor.loadPhotos();
      }
      ctx.fieldHost.general.append(wrap(spec, kitSection({ title: 'Модули изделия', fixed: true, body: ctx.modulesEditor.el })));
    }
  }
  for (const [id, list] of Object.entries(nums)) ctx.fieldHost[id].append(fieldRow(...list));
  const elOn = appliesOf(ctx.applicable, { key: 'elements' }) !== 'na';
  const elOpen = ctx.editing.has('elements') || ctx.missing.some((m) => m.kind === 'elements' || m.key === 'elements');
  if (elOn && (ctx.mode === 'template' || ctx.reveal || elOpen)) ctx.fieldHost.purpose.append(ctx.elSec);
  ctx.els.setIds(ctx.prod.passportDefaults?.elements || []);
}

/** Слоты рисунков. В режиме issue уже загруженный рисунок входит в «Уже заполнено» и скрыт, пока строку не раскроют. */
export function paintSlots(ctx) {
  for (const host of Object.values(ctx.slotHost)) host.replaceChildren();
  if (!ctx.code) {
    ctx.slotHost.general.replaceChildren(hint('Тип паспорта не задан: он берётся из группы или вида изделия.'));
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
    const file = (ctx.pdm || []).find((f) => f.docKind === kind && f.id);
    // Файл PDM — по одноразовой ссылке (C109): прямой путь /uploads/pdm/ закрыт.
    const get = async (e) => {
      const b = e.currentTarget; b.classList.add('is-busy');
      try {
        const t = await api(`/pdm-files/${file.id}/download-ticket`, { method: 'POST' });
        const a = document.createElement('a');
        a.href = href(t.url); a.download = file.name || '';
        document.body.append(a); a.click(); a.remove();
      } catch (er) { toastError(er); } finally { b.classList.remove('is-busy'); }
    };
    return file ? button({ label: 'Взять из PDM', size: 'S', title, onClick: get }) : null;
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

export function focusGap(ctx, m) {
  const section = ctx.secs[gapSection(m)];
  const key = m.kind === 'image' ? 'img_' + imageKind(m) : String(m.key || '');
  const target = [...(section?.querySelectorAll('[data-gap]') || [])]
    .find((el) => el.dataset.gap === key && el.getClientRects().length);
  const control = [...(target?.querySelectorAll('input:not([type="hidden"]), select, textarea, button') || [])]
    .find((el) => !el.matches(':disabled') && el.getClientRects().length);
  control?.focus({ preventScroll: true });
  (target || section)?.scrollIntoView({ block: target ? 'center' : 'nearest', inline: 'nearest' });
}

/** Полоса «Готово N из M», подписи разделов и строка «Уже заполнено». */
export function syncChrome(ctx) {
  const done = (ctx.filled?.length || 0) + textDone(ctx) + (ctx.photoFilled || 0);
  const need = ctx.missing.filter((m) => m.required && !m.defaulted); // выпуску мешает только обязательное; уточнения и необязательное — не «не хватает»
  const miss = need.length;
  const kitOn = ctx.prod.passportDefaults?.isKit === true;
  const asm = ctx.asked.has('assembly') || ctx.byKind.has('assembly');
  for (const [id, sec] of Object.entries(ctx.secs)) {
    const hosts = [ctx.fieldHost[id], ctx.textHost[id], ctx.slotHost[id]];
    const visible = (host) => [...host.childNodes].some((n) => !n.hidden);
    const main = ctx.fieldHost[id].parentElement;
    main.hidden = !visible(ctx.fieldHost[id]) && !visible(ctx.textHost[id]);
    ctx.slotHost[id].hidden = !visible(ctx.slotHost[id]);
    const has = hosts.some(visible);
    if (id === 'other') sec.hidden = !has;
    else if (id === 'assembly') sec.hidden = !(kitOn || asm);
    else if (ctx.mode === 'issue') sec.hidden = !has;
    else sec.hidden = false;
  }
  if (!ctx.code) ctx.strip.replaceChildren(hint('Тип паспорта не задан: задайте его в группе изделия или в виде изделия.', 'warn'));
  else if (!miss) ctx.strip.replaceChildren(badge('Паспорт можно выпускать', 'ok'));
  else {
    const next = link({
      label: `Заполнить: ${gapLabel(need[0])} →`, title: 'Перейти к следующему обязательному полю',
      onClick: () => focusGap(ctx, need[0]),
    });
    ctx.strip.replaceChildren(stack(
      row({ title: `Осталось заполнить: ${miss}`, meta: `Готово ${done} из ${done + miss}`, tone: 'info' }),
      actions(next),
    ));
  }
  const summaryN = done;
  const lines = [];
  if (ctx.mode === 'issue' && summaryN) {
    lines.push(link({
      label: ctx.reveal ? 'Скрыть заполненное' : `Уже заполнено: ${summaryN} ✎ (раскрыть)`,
      title: 'Показать, что уже записано в изделии',
      onClick: () => { ctx.reveal = !ctx.reveal; ctx.repaint(); },
    }));
  }
  // C086: применимое, но необязательное при выпуске не спрашивается — одна строка, раскрывается по желанию
  if (ctx.mode === 'issue' && (ctx.later?.length || ctx.more)) {
    lines.push(link({
      label: ctx.more ? 'Скрыть необязательное' : `Необязательное: ${ctx.later.length} (показать)`,
      title: ctx.more ? 'Оставить только то, без чего паспорт не выпустить' : `Можно указать, выпуску не мешает: ${ctx.later.join(', ')}`,
      onClick: () => { ctx.more = !ctx.more; ctx.repaint(); },
    }));
  }
  ctx.summary.replaceChildren(lines.length ? actions(...lines) : null);
  ctx.onStatus?.({ required: ctx.missing.filter((m) => m.required && !m.defaulted) });
}

export function placeTexts(ctx, list) {
  for (const host of Object.values(ctx.textHost)) host.replaceChildren();
  for (const s of list || []) {
    const node = ctx.fb.stepEl(s.id);
    if (!node) continue;
    ctx.textHost[boxOf(s)].append(node);
  }
}
