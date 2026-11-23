/**
 * C134/C141: паспорт «как в PDF» — эталон правки. Поле правится на листе (inline); справа — ИИ и подсказка.
 * Жизненный цикл: одно открытое поле; перерисовка сохраняет черновик; запись — под замком паспорта.
 */
import { api } from '../../core/api.js';
import { h } from '../../core/dom.js';
import { toast, toastError } from '../../ui/kit/toast.js';
import { confirmDlg } from '../../ui/kit/dialog.js';
import { button, select } from '../../ui/kit/index.js';
import { busyBtn } from '../../ui/kit/busy.js';
import { buildForm } from '../../ui/kit/form.js';
import { srcLegend } from '../../ui/kit/src.js';
import { canEdit, canWorkPassport, ourCompanies } from './common.js';
import { passportAction } from './field-edit.js';
import { pickSourceKey, aiCheckBlock, pageText, exclusive, sidePanel } from './book-shared.js';
import { bindBookScroll, renderBookDocument } from './book-document.js';
import { mountBookChoices } from './book-choices.js';
import { mountBookFocus } from './book-focus.js';
import { imageStrip } from './book-images.js';
import { ilogicBlock } from './book-ilogic.js';
import { SRC_LABEL } from './card-blocks.js';
import { bindBookInlineEvents } from './book-inline-events.js';
import { loadBookTemplate, saveBookTemplate, templateDocument } from './book-template.js';
import { issueBookInstance } from './book-issue.js';
import { paintBookHead, canEditBookInstance, bookEditMessage } from './book-head.js';
import { editBookTemplateText, openBookCategory, openBookSetting, openDescriptionSetup, openSimpleDescription, openBookInstanceInstallation } from './book-template-edit.js';
import { openCompositionInBook, openDimsInBook, openMaterialsInBook } from './book-side-edit.js';
import { bookSettingOpener, bookFocusSettingOpener, paintBookSetup } from './book-setup.js';
import { openExerciseInstructions } from './book-exercise-edit.js';

const hhmm = () => new Date().toTimeString().slice(0, 5);

/** Открыть окно паспорта. onClose(row, changed) — после закрытия. */
export async function openBookEditor(passport, { template = null, position, onClose, isCurrent = () => true } = {}) {
  let row;
  try { row = template ? templateDocument(template) : await api('/passports/' + (passport?.id || passport), { query: { readOnly: 1 } }); }
  catch (e) { toastError(e); return false; }
  if (!isCurrent()) return false;
  const S = { r: row, template, changed: false, cur: null, fit: true };
  const can = () => !!S.template ? canWorkPassport() : canEditBookInstance(S.r, canWorkPassport());
  const pid = () => S.r.id;
  const lock = (fn) => exclusive(S.template ? `template/${S.template.productId}` : pid(), passportAction, fn);
  const setTemplate = (next) => { S.r = templateDocument(next); S.template = next; };
  const refreshRow = async () => {
    if (S.template) setTemplate(await loadBookTemplate(S.template.productId, S.template.variant));
    else S.r = await api('/passports/' + pid());
  };
  let actionBusy = false;
  let draftId = null;

  const readOnlyStat = bookEditMessage(S.r, false);
  const stat = h('span', { class: 'bk-stat', 'aria-live': 'polite' }, bookEditMessage(S.r, can()));
  const tocPagesList = h('div', { class: 'bk-toc-pages-list', 'aria-label': 'Страницы' });
  const tocPages = h('section', { class: 'bk-panel bk-toc-pages' },
    h('header', { class: 'bk-panel-h' }, h('h3', { class: 'bk-toc-h' }, 'Страницы')),
    tocPagesList);
  const tocFocus = h('section', { class: 'bk-panel bk-toc-focus' });
  const tocMeta = h('section', { class: 'bk-panel bk-toc-meta' });
  const tocSetup = h('section', { class: 'bk-panel' });
  const toc = h('nav', { class: 'bk-toc', 'aria-label': 'Страницы и выбор для текстов' }, tocPages, tocFocus, tocMeta);
  const pages = h('div', { class: 'bk-pages bk-fit' });
  const scroller = h('div', { class: 'bk-scroll' }, pages);
  const sideEmpty = () => sidePanel('Подсказки',
    h('p', { class: 'hint bk-toc-hint' }, can()
      ? 'Выберите поле на листе или пункт слева.'
      : 'Паспорт открыт только для чтения.'),
    S.template?.variant === 'short' && can() ? button({ label: 'Краткое описание', size: 'S', onClick: openDescription }) : null,
    S.template?.variant === 'full' && can() ? h('div', { class: 'bk-ed-row' },
      button({ label: 'Части и материалы', size: 'S', onClick: () => openProductSide(openMaterialsInBook) }),
      button({ label: 'Состав изделия', size: 'S', onClick: () => openProductSide(openCompositionInBook) })) : null);
  const slot = h('div', { class: 'bk-side-slot' }, sideEmpty());
  const head = h('div', { class: 'bk-head' });
  const tools = h('div', { class: 'bk-side-tools' },
    aiCheckBlock(() => ({ pages: [...pages.querySelectorAll('.bk-page')].map(pageText) })),
    ilogicBlock());
  const side = h('aside', { class: 'bk-side', 'aria-label': 'Подсказки и ИИ' }, slot, tools);
  const back = h('div', { class: 'modal-back bk-back' }, h('div', { class: 'modal wide bk', role: 'dialog', 'aria-modal': 'true' },
    head, h('div', { class: 'bk-main' }, toc, scroller, side), h('div', { class: 'bk-foot' }, srcLegend(SRC_LABEL), stat)));
  const setStat = (t, tone) => { stat.textContent = t; stat.dataset.tone = tone || ''; };
  let focusApi = null;
  let choicesApi = null;
  let tocPagesLive = [];

  const markTocCurrent = bindBookScroll(scroller, tocPagesList, () => tocPagesLive);

  async function requestClose() {
    if (actionBusy || S.cur?.busy() || choicesApi?.busy() || !await leaveSide()) return;
    if (S.cur?.dirty() && !(await confirmDlg('Закрыть без сохранения?', 'В открытом поле есть несохранённая правка. Она пропадёт.', { okText: 'Закрыть без сохранения', danger: true }))) return;
    document.removeEventListener('keydown', onKey, true);
    back.remove();
    onClose?.(S.r, S.changed);
  }
  const onKey = (e) => {
    if (e.key !== 'Escape' || document.querySelector('.modal-back:not(.bk-back)')) return;
    if (S.template?.variant === 'short' && slot.contains(e.target)
      && e.target.matches?.('[role="combobox"][aria-expanded="true"]')) return;
    e.stopImmediatePropagation(); e.preventDefault();
    if (S.cur) S.cur.cancel();
  };

  let edits = []; // открывалки по порядку на странице — для Tab
  const patchPassport = (body) => {
    if (S.template) throw new Error('Откройте экземпляр, чтобы изменить его реквизиты.');
    return api('/passports/' + pid(), { method: 'PATCH', body });
  };
  const patchTemplate = async (changes, baseline) => {
    setTemplate(await saveBookTemplate(S.template, changes, baseline));
    S.changed = true;
  };
  const ctx = { S, get can() { return can(); }, firms: null, patchPassport, patchTemplate, refreshRow,
    exclusive: lock, rerender: () => render(), editable, imageStrip: (...a) => imageStrip(ctx, ...a), compTree: null };
  /** Ответ паспорта уже содержит проекцию PDF. Выпущенный использует только свой снимок. */
  function ensureComposition() {
    ctx.compTree = { loading: false, lines: Array.isArray(S.r.compositionSheet) ? S.r.compositionSheet : [] };
  }

  function editable(view, spec) {
    if (!can() || spec.readonly || (S.template && !spec.templateEdit && !spec.open)) return view;
    const idx = edits.length;
    view.classList.add('bk-edit');
    view.tabIndex = 0;
    view.setAttribute('role', 'button');
    view.title = 'Нажмите, чтобы править' + (view.title ? ' · ' + view.title : '');
    bindBookInlineEvents(view, () => {
      if (actionBusy) return;
      if (spec.open) { openSide(spec.open); return; }
      if (S.template) { openSide(() => editBookTemplateText(slot, spec, { done: sideDone })); return; }
      openEditor(idx);
    });
    edits.push({ view, spec });
    return view;
  }

  /** Состав в слоте: спросить, если строки менялись; иначе очистить молча. Материалы тоже снимают is-wide. */
  function clearSide() {
    slot._bkLeave = null;
    slot._bkOpening = null; choicesApi?.hideSimple(false);
    side.classList.remove('is-wide', 'is-editing');
    side.closest('.bk-main')?.classList.remove('is-edit-wide');
  }
  async function leaveSide() {
    if (slot._bkLeave && !await slot._bkLeave()) return false;
    clearSide();
    return true;
  }
  function releaseSlot(then) {
    if (!slot._bkLeave) { clearSide(); then(); return; }
    void leaveSide().then((ok) => { if (ok) then(); });
  }
  function openSide(run) {
    if (actionBusy || S.cur?.busy()) return;
    if (S.cur?.dirty()) { warnOpenEdit(); return; }
    releaseSlot(() => {
      S.cur?.cancel();
      slot.replaceChildren(sideEmpty());
      run();
    });
  }
  function sideDone({ saved } = {}) {
    clearSide();
    slot.replaceChildren(sideEmpty());
    if (saved) {
      S.changed = true;
      setStat('Сохранено в ' + hhmm(), 'ok');
      renderNow();
      choicesApi?.refresh();
    }
  }
  function editTemplateSide(open, { description = false, followDictionary = false, followPurpose = false } = {}) {
    const trigger = document.activeElement;
    openSide(() => {
      choicesApi?.hideSimple(description);
      const token = Symbol();
      slot._bkOpening = token;
      slot.replaceChildren(sidePanel('Подготовка правки', h('p', { class: 'hint' }, 'Загружаю…')));
      Promise.resolve(open(slot, S.template, {
        save: (changes, baseline) => lock(() => patchTemplate(changes, baseline)),
        done: (result) => {
          sideDone(result);
          if (followPurpose && result?.saved) { editSetting('purpose'); return; }
          if (followDictionary && result?.saved && !S.template.simpleDescriptionSource) { openDictionaryDescription(); return; }
          if (description) (trigger?.isConnected && trigger !== document.body ? trigger : slot.querySelector('button'))?.focus();
        },
        openDictionary: openDictionaryDescription,
        openParts: openDescription,
        openManual: (initialText) => editTemplateSide((slot, template, options) => openBookSetting(slot, template, { ...options, key: 'purpose', initialText })),
        isCurrent: () => back.isConnected && slot._bkOpening === token,
      })).catch((e) => { if (slot._bkOpening === token) { sideDone(); toastError(e); } });
    });
  }
  function openDescription() { editTemplateSide(openSimpleDescription, { description: true }); }
  function openDictionaryDescription() { editTemplateSide(openDescriptionSetup, { description: true, followDictionary: true }); }
  ctx.openSimple = openDescription;
  ctx.openExercise = () => { if (S.template && can()) editTemplateSide((slot, tpl, opts) => openExerciseInstructions(slot, tpl, { ...opts, isCurrent: () => isCurrent() && opts.isCurrent() })); };
  const editSetting = bookSettingOpener(S, editTemplateSide, openDescription);
  ctx.openDimensions = () => openProductSide(openDimsInBook);
  function openProductSide(open) {
    openSide(() => open(slot, S.r.productId, { onDone: async ({ saved } = {}) => {
      if (saved) {
        try { await refreshRow(); } catch (e) { toastError(e, 'обновить шаблон'); }
      }
      if (back.isConnected) sideDone({ saved });
    } }));
  }

  /** initial — текст, который надо вернуть в поле после перерисовки (несохранённая правка не теряется). */
  function openEditor(idx, initial) {
    releaseSlot(() => openEditorNow(idx, initial));
  }
  function warnOpenEdit() {
    const text = 'Изменения в открытом поле ещё не сохранены. Нажмите кнопку сохранения под полем или «Отмена».';
    S.cur?.warn?.(text);
    toast(text, { tone: 'warn', ms: 12000 });
    S.cur?.focus();
  }
  function openEditorNow(idx, initial) {
    if (S.cur) { if (S.cur.dirty()) { warnOpenEdit(); return; } S.cur.cancel(); }
    const { view, spec } = edits[idx];
    const isTa = !spec.options;
    const ctl = isTa
      ? buildForm([{ key: 'text', label: spec.label, type: 'textarea', rows: spec.rows || 2, wide: true, max: 50000 }], { text: initial ?? spec.text }).el.querySelector('textarea')
      : select({ label: spec.label, value: spec.text, options: spec.options });
    if (isTa) ctl.classList.add('bk-ta');
    const fit = () => { if (isTa) ctl.rows = Math.min(30, Math.max(spec.rows || 2, ctl.value.split('\n').length + (ctl.value.length > 60 ? 1 : 0))); };
    const st = h('span', { class: 'bk-st', 'aria-live': 'polite' });
    const dirty = () => ctl.value !== spec.text;
    let working = false;
    const srcState = {};
    const saveLocal = async (next) => {
      if (working) return;
      if (!dirty()) { S.cur = null; if (next && edits[idx + next]) { render(idx + next); return; } render(); return; }
      busy(true); st.textContent = 'Сохраняю…'; setStat('Сохраняю…', 'busy');
      try { await lock(() => spec.save(ctl.value)); }
      catch (e) { busy(false); st.textContent = 'Не сохранено: ' + (e?.message || 'Не удалось сохранить. Повторите нажатие.'); setStat('Не сохранено — причина под полем', 'err'); toastError(e); return; }
      S.cur = null;
      setStat('Сохранено в ' + hhmm(), 'ok');
      try { await refreshRow(); } catch { toast('Текст сохранён. Откройте паспорт заново, чтобы увидеть обновление.', { error: true }); }
      S.changed = true;
      focusApi?.refresh();
      render(next ? idx + next : undefined);
    };
    const saveShared = async () => {
      if (working) return;
      busy(true); st.textContent = 'Проверяю справочник…';
      try {
        const pick = await pickSourceKey(spec.shared, box, srcState);
        if (pick.stop) { busy(false); st.textContent = pick.stop; return; }
        const t = await lock(() => spec.shared.target(ctl.value, pick.key));
        const text = 'Источник: ' + t.target + '. Затронет изделий: ' + t.affected + '. Новые сборки паспортов получат этот текст; этот и выданные паспорта не изменятся.';
        if (!(await confirmDlg('Сохранить в справочнике?', text, { okText: 'Сохранить в справочнике' }))) { busy(false); st.textContent = ''; return; }
        await lock(() => spec.shared.promote(ctl.value, t.token, pick.key));
        toast('Сохранено: ' + t.target + '. Текст этого паспорта не изменён.');
        setStat('В справочник сохранено в ' + hhmm(), 'ok');
        busy(false); S.cur = null; render();
      } catch (e) { busy(false); st.textContent = ''; toastError(e); }
    };
    const local = button({ label: 'Сохранить в этом паспорте', kind: 'primary', size: 'S', title: 'Enter или Ctrl+Enter', onClick: () => saveLocal() });
    const shared = spec.shared && canEdit() ? button({ label: 'В справочник', size: 'S', title: 'Для всех изделий этой категории или источника', onClick: saveShared }) : null;
    const reset = spec.original != null && spec.original !== '' ? button({ label: 'Вернуть исходный', kind: 'ghost', size: 'S', title: 'Подставить текст из справочника, как было до правки', onClick: () => { ctl.value = spec.original; fit(); ctl.focus(); } }) : null;
    const removeBtn = spec.remove ? button({ label: 'Удалить строку', kind: 'ghost', size: 'S', title: 'Убрать эту строку из таблицы обслуживания', onClick: async () => {
      if (working) return;
      if (!(await confirmDlg('Удалить строку?', 'Строка исчезнет только из этого паспорта.', { okText: 'Удалить', danger: true }))) return;
      busy(true); st.textContent = 'Удаляю…'; setStat('Удаляю…', 'busy');
      try { await lock(() => spec.remove()); }
      catch (e) { busy(false); st.textContent = 'Не удалено'; setStat('Не удалено', 'err'); toastError(e); return; }
      S.cur = null;
      setStat('Удалено в ' + hhmm(), 'ok');
      try { await refreshRow(); } catch { toast('Строка удалена. Откройте паспорт заново, чтобы увидеть обновление.', { error: true }); }
      S.changed = true;
      focusApi?.refresh();
      render();
    } }) : null;
    const cancelBtn = button({ label: 'Отмена', kind: 'ghost', size: 'S', title: 'Esc', onClick: () => { if (!working) { S.cur = null; render(); } } });
    const busy = (on) => { working = on; [local, shared, reset, removeBtn, cancelBtn].forEach((b) => b && (b.disabled = on)); ctl.disabled = on; };
    const box = h('div', { class: 'bk-ed bk-ed-inline' },
      h('div', { class: 'bk-ed-label' }, spec.label || 'Правка'),
      ctl,
      h('div', { class: 'bk-ed-row' }, local, shared, reset, removeBtn, cancelBtn),
      h('div', { class: 'bk-ed-row' }, st, h('span', { class: 'bk-keys' }, 'Enter — сохранить · Esc — отмена · Tab — дальше')));
    if (isTa) ctl.addEventListener('input', fit);
    ctl.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); if (!working) { S.cur = null; render(); } }
      else if (e.key === 'Enter' && (isTa ? !e.shiftKey || e.ctrlKey || e.metaKey : true)) { e.preventDefault(); saveLocal(); }
      else if (e.key === 'Tab') { e.preventDefault(); saveLocal(e.shiftKey ? -1 : 1); }
    });
    // C141: правка на листе — не уводим в правую колонку
    view.classList.add('is-editing');
    view.replaceChildren(box);
    slot.replaceChildren(sideEmpty());
    fit();
    S.cur = { idx, dirty, busy: () => working, value: () => ctl.value, cancel: () => { if (!working) { S.cur = null; render(); } }, focus: () => ctl.focus(), warn: (text) => { st.textContent = text; } };
    ctl.focus();
    view.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function render(openNext) {
    releaseSlot(() => renderNow(openNext));
  }
  function renderNow(openNext) {
    // внешняя перерисовка (картинки) не теряет несохранённый текст: поле откроется заново с тем же текстом
    const keepEd = typeof openNext !== 'number' && S.cur?.dirty() ? { idx: S.cur.idx, value: S.cur.value() } : null;
    S.cur = null; edits = []; slot.replaceChildren(sideEmpty());
    ensureComposition();
    tools.hidden = !can();
    if (!can()) setStat(readOnlyStat);
    if (S.template?.variant === 'short' && can()) toc.prepend(tocSetup, tocMeta, tocFocus, tocPages);
    else toc.prepend(tocPages, tocFocus);
    paintBookSetup(tocSetup, S.template, { can: can(), open: editSetting });
    tocPagesLive = renderBookDocument({ ctx, pages, scroller, tocPagesList, markTocCurrent });
    markTocCurrent(0);
    paintHead();
    focusApi?.refresh();
    if (typeof openNext === 'number' && edits[openNext]) openEditor(openNext);
    else if (keepEd && edits[keepEd.idx]) openEditor(keepEd.idx, keepEd.value);
  }

  async function runHeadAction(buttonEl, message, task) {
    if (actionBusy || S.cur?.busy() || choicesApi?.busy()) return;
    if (S.cur?.dirty()) { warnOpenEdit(); return; }
    actionBusy = true;
    const end = busyBtn(buttonEl, message);
    try {
      if (!await leaveSide()) return;
      slot.replaceChildren(sideEmpty());
      await task();
    } catch (e) { toastError(e); }
    finally { actionBusy = false; end(); paintHead(); }
  }

  function updateBook() { choicesApi?.refresh(); renderNow(); }
  async function showInstance(instance) {
    S.r = await api('/passports/' + instance.id, { query: { readOnly: 1 } });
    S.template = null;
    draftId = null;
    S.changed = true;
    updateBook();
  }
  async function switchTemplate(productId, variant) {
    setTemplate(await loadBookTemplate(productId, variant));
    updateBook();
  }
  async function editDraftTemplate() {
    const row = S.r;
    const next = await loadBookTemplate(row.productId, row.variant);
    draftId = row.id;
    setTemplate(next);
    updateBook();
  }
  async function returnToDraft() {
    const next = await api('/passports/' + draftId);
    S.template = null;
    draftId = null;
    S.r = next;
    updateBook();
  }
  async function changeInstanceVariant(variant) {
    await lock(() => patchPassport({ presentationVersion: 1, variant }));
    await refreshRow();
    S.changed = true;
    updateBook();
  }
  const zoom = (fit) => {
    if (actionBusy) return;
    S.fit = fit;
    pages.classList.toggle('bk-fit', fit);
    pages.classList.toggle('bk-100', !fit);
    paintHead();
  };
  const paintHead = () => paintBookHead(head, {
    S, position, can, zoom, run: runHeadAction, switchTemplate, changeInstanceVariant, showInstance,
    openTemplate: editDraftTemplate, returnToInstance: draftId ? returnToDraft : null, openName: () => { const i = edits.findIndex(({ spec }) => spec.fieldKey === 'name'); if (i >= 0) openEditor(i); },
    issueInstance: (row) => lock(() => issueBookInstance(row)), isMounted: () => back.isConnected, requestClose,
  });

  if (!S.template && can()) {
    try { ctx.firms = (await ourCompanies()).map((o) => [o.id, o.name]); } catch { ctx.firms = null; }
  }
  if (!isCurrent()) return false;
  document.addEventListener('keydown', onKey, true);
  document.body.append(back);
  render();
  const onLeftChanged = () => { if (!slot._bkLeave) render(); else focusApi?.refresh(); };
  choicesApi = mountBookChoices(tocMeta, { S, get can() { return can(); }, lock, patchPassport, patchTemplate, refreshRow, onChanged: onLeftChanged,
    openCategory: () => editTemplateSide(openBookCategory), openPurpose: () => editSetting('purpose') });
  focusApi = mountBookFocus(tocFocus, {
    S, get can() { return can(); }, pagesEl: pages,
    sideSlot: slot,
    openSide,
    openSetting: bookFocusSettingOpener({ S, runHeadAction, editDraftTemplate, openDescription, editSetting, openInstanceInstallation: () => openSide(() => openBookInstanceInstallation(slot, S.r, { done: sideDone, isCurrent: () => back.isConnected, save: async (change) => { await lock(() => patchPassport(change)); await refreshRow(); } })) }),
    openChoices: (root) => choicesApi?.focus(root),
    sideHome: () => { releaseSlot(() => slot.replaceChildren(sideEmpty())); },
    onChanged: async () => {
      try { await refreshRow(); }
      catch (e) { toastError(e, 'обновить паспорт'); return; }
      choicesApi?.refresh(); render();
    },
  });
}
