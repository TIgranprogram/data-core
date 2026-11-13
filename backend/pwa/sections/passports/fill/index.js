import { api, session } from '../../../core/api.js';
import { h } from '../../../core/dom.js';
import { actions, button, clamp, confirmDlg, enhanceSelect, field, headbar, hint, layout, link, section, segmented, select, stack, toastError } from '../../../ui/kit/index.js';
import { kindNorm } from '../../../core/passport-kinds.js';
import { canEdit as canEditTexts, canWorkPassport, dictRows, passportCategoryOptions } from '../common.js';
import { elementsTexts } from '../elements-block.js';
import { passportVariant, previewPassport, VARIANT_HINT } from '../dialogs.js';
import { loadGaps, loadTexts, putDefaults } from '../funnel/api.js';
import { resetPdCategory } from '../../products/data.js';
import { changeCategory } from './category-change.js';
import { saveQueue } from './save-queue.js';
import { openTechSheet } from '../../tech-sheet.js';
import { ownTexts } from '../template-texts.js';
import { SECTIONS, displayName, imageKind, matText, typeOfLeaf } from './model.js';
import { paintFields, paintSlots, placeTexts, syncChrome } from './paint.js';

/**
 * Эталон «Заполнение паспорта изделия» (C056 Д).
 * mode template — правка шаблона: все разделы, заполненное строкой ✎, пустое открыто.
 * mode issue — шаги 5–6 «Нового паспорта»: заполненное одной строкой, открыто только пустое.
 *   passportFill({ prod, mode, onStatus }) → { el, reload(), missingRequired() }
 */
export async function passportFill({ prod, mode = 'template', onStatus, showVariant = true } = {}) {
  const can = !!(session.canEdit && canWorkPassport());
  const [catOpts, elRows, instRows] = await Promise.all([
    passportCategoryOptions(), dictRows('passportElements'), dictRows('passportInstall'),
  ]);
  const { funnelBox } = await import('../../../ui/funnel.js');
  const fieldHost = {}; const textHost = {}; const slotHost = {}; const titles = {}; const secs = {};
  for (const [id, title] of SECTIONS) {
    // строки раздела — ровным шагом kit (k-stack), не впритык
    fieldHost[id] = stack(); textHost[id] = stack(); slotHost[id] = h('div'); titles[id] = title;
    const body = [layout.related({ main: stack(fieldHost[id], textHost[id]), side: slotHost[id] })];
    if (id === 'dims') body.unshift(hint('В каждое место вставьте одно изображение. Для габаритов — один чертёж с размерами: виды спереди, сбоку и сверху можно объединить на одном листе. Отдельные места для видов доступны в варианте «Полный». Звёздочкой отмечены обязательные рисунки.'));
    secs[id] = section({ title, fixed: true, tone: 'info', body });
  }
  const els = elementsTexts(elRows, { canEdit: canEditTexts, onSaved: () => reload() }); // тексты элемента правятся здесь же, не в справочнике
  const elSec = section({ title: 'Тексты элементов', open: false, tone: 'neutral', body: els.el });
  const strip = h('div'); const summary = h('div'); const catSuggest = h('div'); const context = h('div');
  const pending = new Map(); const editing = new Set();
  let paused = false; let pauseEpoch = 0;
  const writes = saveQueue(); const saves = writes.pending;
  const saveError = stack();
  let changingCategory = false;
  let seq = 0; let ready = false; let mute = 1; let synced = false; let fb;

  const codeOf = () => prod.passportDefaults?.passportCategory || prod.passportCategory?.code || '';
  const instOptsOf = () => instRows.filter((d) => {
    const cats = String(d.categories || '').split(/[,;\s]+/).filter(Boolean);
    return !cats.length || cats.includes(catSel.value || codeOf());
  }).map((d) => [String(d.id || d._id), d.name || '']);

  const ctx = {
    pause: () => { paused = true; pauseEpoch++; seq++; return () => { paused = false; }; },
    waitForSaves: () => Promise.all([...saves]),
    refreshStatus: () => refreshStatus(),
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
    label: 'Вариант паспорта', value: passportVariant.value, fit: true,
    items: [{ key: 'short', label: 'Упрощённый' }, { key: 'full', label: 'Полный' }],
    onChange: (k) => { passportVariant.value = k; ctx.repaint(); },
  });

  function draw() {
    if (paused || writes.failed()) return;
    ctx.instOpts = instOptsOf();
    ctx.instNames = new Map(ctx.instOpts);
    ctx.code = catSel.value || codeOf();
    ctx.full = passportVariant.value === 'full';
    ctx.matLine = matText(prod);
    ctx.unnamed = !!(prod.needsName || (prod.composition || []).some((l) => l.needsName));
    const inst = fb?.install?.();
    ctx.covered = !!(inst?.leaves || []).some((l) => typeOfLeaf(l, ctx.instOpts));
    paintFields(ctx); paintSlots(ctx); syncChrome(ctx);
    paintContext();
  }

  /** Шапка: изделие, категория и тип видны сразу (C086). Тип нужен, но неизвестен — так и сказано, без догадки. */
  function paintContext() {
    const cat = catOpts.find((c) => c.value === ctx.code)?.label || '';
    const t = ctx.applicable?.type;
    const typeText = !t?.needed ? '' : t.known ? t.label : 'не определён — уточните назначение';
    const from = { purpose: 'по назначению', group: 'по группе каталога', facet: 'по признаку' }[t?.source] || '';
    context.replaceChildren(
      clamp(h('span', null, h('b', null, displayName(prod.name)), prod.sku ? h('span', { class: 'muted' }, ' · ' + prod.sku) : null), { lines: 2 }),
      h('div', { class: 'muted small' },
        'Категория: ', h(cat ? 'span' : 'b', null, cat || 'не выбрана'),
        typeText ? ' · Тип: ' : null, typeText ? h(t.known ? 'span' : 'b', { title: from || null }, typeText) : null,
        mode === 'issue' ? ' · ' : null,
        mode === 'issue' ? link({ label: catBox.hidden ? 'изменить' : 'скрыть', title: 'Категория паспорта изделия', onClick: () => { catBox.hidden = !catBox.hidden; paintContext(); } }) : null),
    );
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
    category: catSel.value, canEditText: canEditTexts(), productId: prod.id, facetFirst: true,
    load: async (cat) => ({ sections: await loadTexts(cat, prod.id) }),
    onPaint: (list) => {
      if (!fb) return;
      if (paused || writes.failed()) return;
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
    const epoch = pauseEpoch;
    try { const result = await writes.add(job); if (result !== false && !writes.failed() && !saves.size && epoch === pauseEpoch) await reload(); }
    catch (e) { showSaveError(); toastError(e, 'сохранить в изделие'); }
  }
  ctx.save = save;

  function lockAfterError(locked) {
    for (const child of el.children) if (child !== saveError) child.inert = locked;
  }
  function showSaveError() {
    lockAfterError(true);
    let resolving = false;
    const resolve = async (action) => {
      if (resolving) return;
      resolving = true; retry.disabled = true; discard.disabled = true;
      try { await action(); } finally { resolving = false; retry.disabled = false; discard.disabled = false; }
    };
    const retry = button({ label: 'Повторить сохранение', onClick: () => resolve(async () => {
        try { await writes.retry(); if (writes.failed()) return; saveError.replaceChildren(); lockAfterError(false); await reload(); }
        catch (e) { toastError(e, 'повторить сохранение'); }
      }) });
    const discard = button({ label: 'Отменить несохранённые правки', kind: 'ghost', onClick: () => resolve(async () => {
        if (!(await confirmDlg('Отменить несохранённые правки?', 'Останутся только сведения, которые сервер уже сохранил.', { okText: 'Отменить правки' }))) return;
        try {
          const fresh = await api(`/showcase/${prod.id}`);
          await writes.discard(); saveError.replaceChildren(); lockAfterError(false);
          Object.assign(prod, fresh); await reload();
        } catch (e) { toastError(e, 'прочитать сохранённое изделие'); }
      }) });
    saveError.replaceChildren(hint('Правка не сохранилась. Ввод оставлен на экране; следующие изменения ждут повтора.', 'warn'), actions(retry, discard));
  }

  async function saveTexts() {
    if (!can || changingCategory) return;
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
    catSel.value = codeOf();
    if (catSel.disabled) return;
    catSel.disabled = true;
    changingCategory = true;
    const wasInert = fb.el.inert; fb.el.inert = true;
    try {
      await save(async () => {
        const changed = await changeCategory(prod, v, {
          approve: () => confirmDlg('Сменить категорию паспорта?', 'Выбранные тексты и ручные правки шаблона этого изделия будут очищены. Остальные сведения сохранятся. Выпущенные паспорта не изменятся.', { okText: 'Сменить и очистить тексты' }),
          put: putDefaults, reset: resetPdCategory, read: (id) => api(`/showcase/${id}`),
        });
        if (!changed) return false;
        catSel.value = codeOf(); mute += 2; synced = false;
        fb.setCategory(codeOf());
      });
    } finally { catSel.value = codeOf(); catSel.disabled = false; fb.el.inert = wasInert || writes.failed(); changingCategory = false; }
  }

  async function reload() {
    if (paused || writes.failed()) return ctx.missing;
    const my = ++seq;
    let photos = []; let files = []; let gaps;
    try {
      [photos, files] = await Promise.all([
        api(`/products/${prod.id}/photos?purpose=passport`).then((x) => x.items || x).catch(() => []),
        api('/pdm-files', { query: { ownerKind: 'product', ownerId: prod.id } }).then((x) => x.items || []).catch(() => []),
      ]);
      gaps = await loadGaps(prod.id);
    } catch (e) {
      if (paused || my !== seq) return ctx.missing;
      toastError(e, 'проверить изделие');
      strip.replaceChildren(hint('Не удалось узнать, чего не хватает.', 'warn'), button({ label: 'Повторить', size: 'S', onClick: () => reload() }));
      return ctx.missing;
    }
    if (paused || my !== seq) return ctx.missing;
    if (gaps.category) prod.category = gaps.category;
    ctx.missing = gaps.missing || [];
    ctx.applicable = gaps.applicable || null; // C086: что относится к изделию — одно правило с сервером
    ctx.byKind = new Map((photos || []).map((x) => [kindNorm(x.kind), x]));
    ctx.asked = new Set(ctx.missing.filter((m) => m.kind === 'image' || String(m.key || '').startsWith('img_')).map(imageKind));
    ctx.pdm = files || [];
    editing.clear();
    ready = true;
    own?.load();
    draw();
    return ctx.missing;
  }

  /** Обновить готовность после справочника, сохранив DOM всех полей и черновиков. */
  async function refreshStatus() {
    try {
      const gaps = await loadGaps(prod.id);
      ctx.missing = gaps.missing || [];
      ctx.applicable = gaps.applicable || null;
      const hasElements = !!prod.passportDefaults?.elements?.length;
      const needsElements = ctx.missing.some((m) => m.kind === 'elements' || m.key === 'elements');
      ctx.filled = (ctx.filled || []).filter((key) => key !== 'elements');
      if (hasElements && !needsElements) ctx.filled.push('elements');
      syncChrome(ctx);
    } catch (e) { toastError(e, 'проверить готовность паспорта'); }
  }

  async function missingRequired() {
    await Promise.all([...saves]);
    if (writes.failed()) throw new Error('Сначала повторите сохранение или отмените несохранённые правки');
    await reload();
    return ctx.missing.filter((m) => m.required);
  }

  const own = mode === 'template' ? ownTexts({ r: prod, can, save }) : null;
  const foot = actions(
    button({ label: 'Предпросмотр', title: 'PDF с пометкой «ЧЕРНОВИК». Паспорт не выпускается', onClick: () => previewPassport(prod.id) }),
  );
  // C086: шапка — изделие, категория и тип слева, вариант компактно справа (на узкой панели переносится).
  // При выпуске категория (из группы изделия) — не вопрос: список открывается по «изменить» или сам, если категории нет (C070-П3).
  const catBox = h('div', null, field('Категория паспорта', catSel));
  catBox.hidden = mode === 'issue' && !!codeOf();
  variant.el.title = VARIANT_HINT;
  const setup = [
    headbar(context, showVariant ? variant.el : null),
    catBox, catSuggest,
  ];
  const el = stack(
    saveError,
    ...setup,
    strip, summary, ...SECTIONS.map(([id]) => secs[id]), own?.el, foot, fb.el,
  );
  await reload();
  return {
    el, reload, missingRequired, readonly: true, dirty: () => writes.failed(), busy: () => saves.size > 0,
    doneLabel: mode === 'template' ? 'Готово' : undefined,
    beforeClose: async () => { await Promise.all([...saves]); if (writes.failed()) throw new Error('Сначала повторите сохранение или отмените несохранённые правки'); },
    focus: () => catSel.focus?.(),
    read: () => ({ values: { category: catSel.value, choices: JSON.parse(fb.value || '{}'), over: {} } }),
  };
}

export const templateForm = (prod) => passportFill({ prod, mode: 'template' });
