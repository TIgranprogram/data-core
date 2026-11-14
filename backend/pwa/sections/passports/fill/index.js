import { api, session } from '../../../core/api.js';
import { h } from '../../../core/dom.js';
import { actions, button, clamp, confirmDlg, headbar, hint, layout, section, segmented, stack, toastError } from '../../../ui/kit/index.js';
import { kindNorm } from '../../../core/passport-kinds.js';
import { canEdit as canEditTexts, canWorkPassport, dictRows, passportCategoryOptions, passportTypeLine } from '../common.js';
import { elementsTexts } from '../elements-block.js';
import { passportVariant, previewPassport, VARIANT_HINT } from '../dialogs.js';
import { loadGaps, loadTexts, putDefaults } from '../funnel/api.js';
import { resetPdCategory } from '../../products/data.js';
import { changeCategory } from './category-change.js';
import { saveQueue } from './save-queue.js';
import { retryDelay } from '../../../core/write-retry.js';
import { openTechSheet } from '../../tech-sheet.js';
import { ownTexts } from '../template-texts.js';
import { SECTIONS, displayName, imageKind, matText, typeOfLeaf } from './model.js';
import { focusGap, paintFields, paintSlots, placeTexts, syncChrome } from './paint.js';

/**
 * Эталон «Заполнение паспорта изделия» (C056 Д).
 * mode template — правка шаблона: все разделы, заполненное строкой ✎, пустое открыто.
 * mode issue — шаги 5–6 «Нового паспорта»: заполненное одной строкой, открыто только пустое.
 *   passportFill({ prod, mode, onStatus }) → { el, reload(), missingRequired() }
 */
export async function passportFill({ prod, mode = 'template', onStatus, showVariant = true } = {}) {
  const can = !!(session.canEdit && canWorkPassport());
  const [catOpts, elRows, instRows, kindRows] = await Promise.all([
    passportCategoryOptions(), dictRows('passportElements'), dictRows('passportInstall'), dictRows('passportKinds'),
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
  const strip = h('div'); const summary = h('div'); const context = h('div');
  const pending = new Map(); const editing = new Set();
  let paused = false; let pauseEpoch = 0;
  const saveError = stack();
  let waitNote = ''; // Р2: «сохраню, когда сервер вернётся» — пока очередь сама ждёт повтор
  const writes = saveQueue({ auto: {
    delayOf: retryDelay, max: 5,
    onWait: (ms) => { waitNote = `Сервер на паузе или нет связи. Сохраню сам через ${Math.round(ms / 1000)} с — ввод остаётся на экране.`; showSaveError(); },
    onResume: () => { waitNote = ''; saveError.replaceChildren(); lockAfterError(false); reload(); },
  } });
  const saves = writes.pending;
  let changingCategory = false;
  let seq = 0; let ready = false; let mute = 1; let synced = false; let fb;

  const codeOf = () => prod.passportDefaults?.passportCategory || prod.passportCategory?.code || '';
  const instOptsOf = () => instRows.filter((d) => {
    const cats = String(d.categories || '').split(/[,;\s]+/).filter(Boolean);
    return !cats.length || cats.includes(codeOf());
  }).map((d) => [String(d.id || d._id), d.name || '']);

  const ctx = {
    pause: () => { paused = true; pauseEpoch++; seq++; return () => { paused = false; }; },
    waitForSaves: () => Promise.all([...saves]),
    refreshStatus: () => refreshStatus(),
    prod, mode, can, pending, editing, reveal: false, missing: [], byKind: new Map(), asked: new Set(), pdm: [],
    fieldHost, textHost, slotHost, titles, secs, strip, summary, els, elSec, kindRows,
    elRows, elNames: new Map(elRows.map((d) => [String(d.id || d._id), d.name || 'без названия'])),
    onStatus, openTech: () => openTechSheet(prod),
    repaint: () => { if (ready) draw(); },
    reload: () => reload(),
  };

  const variant = segmented({
    label: 'Вариант паспорта', value: passportVariant.value, fit: true,
    items: [{ key: 'short', label: 'Упрощённый' }, { key: 'full', label: 'Полный' }],
    onChange: (k) => { passportVariant.value = k; ctx.repaint(); },
  });

  function draw() {
    if (paused || writes.failed()) return;
    ctx.instOpts = instOptsOf();
    ctx.instNames = new Map(ctx.instOpts);
    ctx.code = ctx.catInfo?.code || codeOf();
    ctx.full = passportVariant.value === 'full';
    ctx.matLine = matText(prod);
    ctx.unnamed = !!(prod.needsName || (prod.composition || []).some((l) => l.needsName));
    const inst = fb?.install?.();
    ctx.covered = !!(inst?.leaves || []).some((l) => typeOfLeaf(l, ctx.instOpts));
    paintFields(ctx); paintSlots(ctx); syncChrome(ctx);
    paintContext();
  }

  /** Шапка: изделие, назначение и тип паспорта видны сразу (C086, C103). Тип паспорта только читается: задаётся в группе или в виде изделия. */
  function paintContext() {
    const info = ctx.catInfo;
    const name = ctx.code ? (info?.name || catOpts.find((c) => c.value === ctx.code)?.label || ctx.code) : '';
    const own = !!prod.passportDefaults?.passportCategory && (!info || info.source === 'own' || !info.source);
    const via = info?.source === 'kind' ? `вид «${ctx.kind?.name || ''}»` : (prod.passportCategory?.inherited?.via || (prod.group ? `группа «${prod.group}»` : 'группа'));
    const t = ctx.applicable?.type;
    const typeText = !t?.needed ? '' : t.known ? t.label : 'не определено — уточните назначение';
    const from = { purpose: 'по назначению', group: 'по группе каталога', facet: 'по признаку' }[t?.source] || '';
    context.replaceChildren(
      clamp(h('span', null, h('b', null, displayName(prod.name)), prod.sku ? h('span', { class: 'muted' }, ' · ' + prod.sku) : null), { lines: 2 }),
      typeText ? h('div', { class: 'muted small' }, 'Назначение изделия: ', h(t.known ? 'span' : 'b', { title: from || null }, typeText)) : null,
      passportTypeLine({ name, from: via, own, groupId: prod.groupId, onReset: can ? () => resetOwn() : null }),
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
    category: codeOf(), canEditText: canEditTexts(), productId: prod.id, facetFirst: true,
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
  ctx.saveModules = async (modules) => {
    const result = await writes.add(async () => {
      try { await putDefaults(prod, { modules }); return true; }
      catch (e) { return e; }
    });
    if (result !== true) throw result || new Error('Сначала завершите сохранение предыдущих изменений.');
  };

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
    saveError.replaceChildren(hint(waitNote || 'Правка не сохранилась. Ввод оставлен на экране; следующие изменения ждут повтора.', 'warn'), actions(retry, discard));
  }

  async function saveTexts() {
    if (!can || changingCategory) return;
    const choices = JSON.parse(fb.value || '{}');
    const inst = typeOfLeaf(fb.installLeaf(), instOptsOf());
    const prev = prod.passportDefaults || {};
    const same = JSON.stringify(choices) === JSON.stringify(prev.textChoices || {});
    if (same && (!inst || String(prev.installationTypeId || '') === inst)) return;
    const change = { textChoices: choices };
    if (inst) change.installationTypeId = inst;
    await save(() => putDefaults(prod, change));
  }

  /** «Брать из группы»: убрать тип паспорта, записанный в самом изделии (старые данные). */
  async function resetOwn() {
    if (changingCategory) return;
    changingCategory = true;
    const wasInert = fb.el.inert; fb.el.inert = true;
    try {
      await save(async () => {
        const changed = await changeCategory(prod, '', {
          approve: () => confirmDlg('Брать тип паспорта из группы?', 'Если у группы другой тип паспорта, выбранные тексты и ручные правки шаблона этого изделия будут очищены. Остальные сведения сохранятся. Выпущенные паспорта не изменятся.', { okText: 'Брать из группы' }),
          put: putDefaults, reset: resetPdCategory, read: (id) => api(`/showcase/${id}`),
        });
        if (!changed) return false;
        mute += 2; synced = false;
        fb.setCategory(codeOf());
      });
    } finally { fb.el.inert = wasInert || writes.failed(); changingCategory = false; }
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
    ctx.catInfo = gaps.category || null; // C103: тип паспорта и откуда он (own | kind | group)
    ctx.missing = gaps.missing || [];
    ctx.kind = gaps.kind || null; // C100: вид изделия и откуда он
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
      ctx.kind = gaps.kind || null;
      ctx.catInfo = gaps.category || null;
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
    return ctx.missing.filter((m) => m.required && !m.defaulted);
  }

  const own = mode === 'template' ? ownTexts({ r: prod, can, save }) : null;
  const foot = actions(
    button({ label: 'Предпросмотр', title: 'PDF с пометкой «ЧЕРНОВИК». Паспорт не выпускается', onClick: () => previewPassport(prod.id) }),
  );
  // C086/C103: шапка — изделие и тип паспорта (чтение, с источником) слева, вариант компактно справа (на узкой панели переносится).
  variant.el.title = VARIANT_HINT;
  const setup = [
    headbar(context, showVariant ? variant.el : null),
    showVariant ? hint('Упрощённый — основное. ' + VARIANT_HINT + '.') : null,
  ].filter(Boolean);
  const el = stack(
    saveError,
    ...setup,
    strip, summary, ...SECTIONS.map(([id]) => secs[id]), own?.el, foot, fb.el,
  );
  await reload();
  return {
    el, reload, missingRequired, focusGap: (m) => focusGap(ctx, m), readonly: true, dirty: () => writes.failed(), busy: () => saves.size > 0,
    doneLabel: mode === 'template' ? 'Готово' : undefined,
    beforeClose: async () => { await ctx.modulesEditor?.flush(); await Promise.all([...saves]); if (writes.failed()) throw new Error('Сначала повторите сохранение или отмените несохранённые правки'); },
    focus: () => {},
    read: () => ({ values: { category: ctx.code, choices: JSON.parse(fb.value || '{}'), over: {} } }),
  };
}

export const templateForm = (prod) => passportFill({ prod, mode: 'template' });
