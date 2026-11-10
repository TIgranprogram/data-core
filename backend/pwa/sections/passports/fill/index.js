import { api, session } from '../../../core/api.js';
import { h } from '../../../core/dom.js';
import { actions, button, enhanceSelect, hint, section, segmented, select, stack, toastError } from '../../../ui/kit/index.js';
import { kindNorm } from '../../../core/passport-kinds.js';
import { canEdit as canEditTexts, dictRows, passportCategoryOptions } from '../common.js';
import { elementsTexts } from '../elements-block.js';
import { passportVariant, previewPassport, VARIANT_HINT } from '../dialogs.js';
import { loadGaps, loadTexts, putDefaults } from '../funnel/api.js';
import { savePd } from '../../products/data.js';
import { openTechSheet } from '../../tech-sheet.js';
import { ownTexts } from '../template-texts.js';
import { commitPending } from './control.js';
import { SECTIONS, imageKind, matText, typeOfLeaf } from './model.js';
import { paintFields, paintSlots, placeTexts, syncChrome } from './paint.js';

/**
 * Эталон «Заполнение паспорта изделия» (C056 Д).
 * mode template — правка шаблона: все разделы, заполненное строкой ✎, пустое открыто.
 * mode issue — шаги 5–6 «Нового паспорта»: заполненное одной строкой, открыто только пустое.
 *   passportFill({ prod, mode, onStatus }) → { el, reload(), missingRequired() }
 */
export async function passportFill({ prod, mode = 'template', onStatus } = {}) {
  const can = !!(session.canEdit && canEditTexts());
  const [catOpts, elRows, instRows] = await Promise.all([
    passportCategoryOptions(), dictRows('passportElements'), dictRows('passportInstall'),
  ]);
  const { funnelBox } = await import('../../../ui/funnel.js');
  const fieldHost = {}; const textHost = {}; const slotHost = {}; const titles = {}; const secs = {};
  for (const [id, title] of SECTIONS) {
    fieldHost[id] = h('div'); textHost[id] = h('div'); slotHost[id] = h('div'); titles[id] = title;
    const body = [fieldHost[id], textHost[id], slotHost[id]];
    if (id === 'dims') body.unshift(hint('Рисунок — один: чертёж с габаритами. На нём можно показать сразу все виды. Отдельные места под каждый вид — в варианте «Полный».'));
    secs[id] = section({ title, fixed: true, tone: 'info', body });
  }
  const els = elementsTexts(elRows);
  const elSec = section({ title: 'Тексты элементов', open: false, tone: 'neutral', body: els.el });
  const strip = h('div'); const summary = h('div'); const catSuggest = h('div');
  const pending = new Map(); const editing = new Set();
  let seq = 0; let ready = false; let mute = 1; let synced = false; let fb;

  const codeOf = () => prod.passportDefaults?.passportCategory || prod.passportCategory?.code || '';
  const instOptsOf = () => instRows.filter((d) => {
    const cats = String(d.categories || '').split(/[,;\s]+/).filter(Boolean);
    return !cats.length || cats.includes(catSel.value || codeOf());
  }).map((d) => [String(d.id || d._id), d.name || '']);

  const ctx = {
    prod, mode, can, pending, editing, reveal: false, missing: [], byKind: new Map(), asked: new Set(), pdm: [],
    fieldHost, textHost, slotHost, titles, secs, strip, summary, catSuggest, els, elSec,
    elRows, elNames: new Map(elRows.map((d) => [String(d.id || d._id), d.name || 'без названия'])),
    onStatus, openTech: () => openTechSheet(prod),
    repaint: () => { if (ready) draw(); },
    reload: () => reload(),
    onCategory: (v) => onCategory(v),
  };

  const catSel = select({
    label: 'Категория паспорта',
    options: [['', '— по разделу и группе —'], ...catOpts.map((c) => [c.value, c.label])],
    value: prod.passportDefaults?.passportCategory || codeOf(),
    onChange: (v) => onCategory(v),
  });
  if (catOpts.length > 12) enhanceSelect(catSel);
  const variant = segmented({
    label: 'Вариант паспорта', value: passportVariant.value,
    items: [{ key: 'short', label: 'Упрощённый' }, { key: 'full', label: 'Полный' }],
    onChange: (k) => { passportVariant.value = k; ctx.repaint(); },
  });

  function draw() {
    ctx.instOpts = instOptsOf();
    ctx.instNames = new Map(ctx.instOpts);
    ctx.code = catSel.value || codeOf();
    ctx.full = passportVariant.value === 'full';
    ctx.matLine = matText(prod);
    ctx.unnamed = !!(prod.needsName || (prod.composition || []).some((l) => l.needsName));
    const inst = fb?.install?.();
    ctx.covered = !!(inst?.leaves || []).some((l) => typeOfLeaf(l, ctx.instOpts));
    paintFields(ctx); paintSlots(ctx); syncChrome(ctx);
  }

  function maybeSync() {
    if (synced || !can || !fb) return;
    const inst = fb.install();
    if (!inst.section || !inst.leaves.length) return;
    synced = true;
    const was = String(prod.passportDefaults?.installationTypeId || '');
    if (inst.chosen || !was) return;
    const leaf = inst.leaves.find((l) => typeOfLeaf(l, instOptsOf()) === was);
    if (leaf) fb.choose(inst.section.id, leaf.id);
  }

  fb = funnelBox({
    value: JSON.stringify(prod.passportDefaults?.textChoices || {}),
    category: catSel.value, canEditText: can, productId: prod.id, facetFirst: true,
    load: async (cat) => ({ sections: await loadTexts(cat, prod.id) }),
    onPaint: (list) => {
      if (!fb) return;
      placeTexts(ctx, list);
      fb.el.hidden = !fb.el.childNodes.length;
      maybeSync();
      if (ready) draw();
    },
  });
  ctx.fb = fb;
  fb.el.hidden = true;
  fb.el.addEventListener('change', () => { if (mute) { mute--; return; } saveTexts(); });

  async function save(job) {
    if (!can) return;
    try { await job(); await reload(); } catch (e) { toastError(e, 'сохранить в изделие'); }
  }
  ctx.save = save;

  async function saveTexts() {
    if (!can) return;
    const choices = JSON.parse(fb.value || '{}');
    const inst = typeOfLeaf(fb.installLeaf(), instOptsOf());
    const prev = prod.passportDefaults || {};
    const same = JSON.stringify(choices) === JSON.stringify(prev.textChoices || {});
    if (same && (!inst || String(prev.installationTypeId || '') === inst)) return;
    const change = { textChoices: choices };
    if (catSel.value) change.passportCategory = catSel.value;
    if (inst) change.installationTypeId = inst;
    await save(() => putDefaults(prod, change));
  }

  async function onCategory(v) {
    mute += 2; synced = false;
    fb.setCategory(v);
    try {
      if (!v) await savePd(prod.id, { category: '', choices: {}, over: {}, derived: prod.passportCategory?.code || '', prev: prod.passportDefaults || {} });
      else await putDefaults(prod, { passportCategory: v, textChoices: {}, textOverrides: {} });
      Object.assign(prod, await api(`/showcase/${prod.id}`));
      await reload();
    } catch (e) { toastError(e, 'сохранить категорию'); }
  }

  async function reload() {
    const my = ++seq;
    let photos = []; let files = []; let gaps;
    try {
      [photos, files] = await Promise.all([
        api(`/products/${prod.id}/photos?purpose=passport`).then((x) => x.items || x).catch(() => []),
        api('/pdm-files', { query: { ownerKind: 'product', ownerId: prod.id } }).then((x) => x.items || []).catch(() => []),
      ]);
      gaps = await loadGaps(prod.id);
    } catch (e) {
      toastError(e, 'проверить изделие');
      strip.replaceChildren(hint('Не удалось узнать, чего не хватает. Откройте форму ещё раз.', 'warn'));
      return ctx.missing;
    }
    if (my !== seq) return ctx.missing;
    if (gaps.category) prod.category = gaps.category;
    ctx.missing = gaps.missing || [];
    ctx.byKind = new Map((photos || []).map((x) => [kindNorm(x.kind), x]));
    ctx.asked = new Set(ctx.missing.filter((m) => m.kind === 'image' || String(m.key || '').startsWith('img_')).map(imageKind));
    ctx.pdm = files || [];
    editing.clear();
    ready = true;
    own?.load();
    draw();
    return ctx.missing;
  }

  async function missingRequired() {
    await commitPending(prod, pending);
    await reload();
    return ctx.missing.filter((m) => m.required);
  }

  const own = mode === 'template' ? ownTexts({ r: prod, can, save }) : null;
  const foot = mode === 'template' ? actions(
    button({ label: 'Предпросмотр', title: 'PDF с пометкой «ЧЕРНОВИК». Паспорт не выпускается', onClick: () => previewPassport(prod.id) }),
  ) : null;
  const el = stack(
    hint('Категория паспорта'), catSel, catSuggest,
    hint('Вариант паспорта'), variant.el, hint(VARIANT_HINT),
    strip, summary, ...SECTIONS.map(([id]) => secs[id]), own?.el, foot, fb.el,
  );
  ctx.root = el;
  await reload();
  return {
    el, reload, missingRequired, readonly: true, dirty: () => false,
    doneLabel: mode === 'template' ? 'Готово' : undefined,
    beforeClose: () => commitPending(prod, pending),
    focus: () => catSel.focus?.(),
    read: () => ({ values: { category: catSel.value, choices: JSON.parse(fb.value || '{}'), over: {} } }),
  };
}

export const templateForm = (prod) => passportFill({ prod, mode: 'template' });
