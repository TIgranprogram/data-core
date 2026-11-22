import { api, canEditSection, PREFIX, session } from '../../core/api.js';
import { reportError } from '../../core/errors.js';
import { mark } from './mark.js';
import { cardParent, registerCardParent } from './card-parent.js';
import { h } from '../../core/dom.js';
import { readonlyGroups } from './readonly.js';
import { go } from '../../core/router.js';
import { dateTime } from '../../core/format.js';
import { actionLabel, changeList, usefulEntry } from '../history.js';
import { confirmDlg } from './dialog.js';
import { withConfirm } from '../confirm-password.js';
import { photoDrop } from './photos.js';
import { buildForm } from './form.js';
import { gallery } from './card-gallery.js';
import { toast, toastError } from './toast.js';
import { actionText, errText, isFailure } from './errors.js';
import { busyBlock, busyBtn, failBlock } from './busy.js';
import { buildCardTabs } from './card-tabs.js';
import { fillCardMenu } from './card-menu.js';
import { makeResizable } from '../resizer.js';
import { DOCK_MIN, getPref, setPref } from '../../core/prefs.js';
import { isSolo, popout, returnToPanel, setPopout, soloGeometry } from '../../core/popout.js'; // панель в отдельном окне (2026-11-10)
/**
 * Карточка записи: просмотр / правка / создание (CANON §2).
 * section: title, entityType, noun, get(id), popout:false (только панель); card: heading, view, subheading/stats/actions/extra/parent/startEdit/noHistory.
 * Изображения: card.gallery(row), photoAdd/Remove(row, photoId); форма: fields/build, toBody, create/update, initial.
 * section.remove: run/restore/text/blocked; duplicate(row) возвращает начальные значения копии.
 * ctx.close() закрывает панель; ctx.changed() обновляет список; load(id) показывает соседнюю запись.
 * На широком экране (≥ DOCK_MIN) панель пристыкована без затемнения; список остаётся кликабельным.
 * Зоны: card.zones или data-zone (main/side/wide), DESIGN §4; раскладка выбирается в меню «⋯» (prefs panelLayout).
 */
export const LAYOUTS = [['one', 'Одна колонка'], ['two', 'Две колонки'], ['wide', 'Две колонки и широкий блок снизу']];
const layoutNow = () => { const v = getPref('panelLayout'); return LAYOUTS.some(([k]) => k === v) ? v : 'one'; };
const docked = () => window.innerWidth >= DOCK_MIN;
/** Заголовок панели: строка, узел или массив (с null) → список без пустых мест; узел никогда не склеивается в строку. */
const parts = (x) => [].concat(x ?? []).filter((n) => n !== null && n !== undefined && n !== false && n !== '');
export function openCard(section, { id, mode = 'view', initial, fill, parent }, ctx) {
  let row = null;
  let form = null;
  let saving = false;
  let building = false;
  let disposed = false;
  const inlineEdits = new WeakMap(); // счётчик редакторов для конкретной кнопки текущего просмотра
  let openTab = null; // T9 (C052): card.tabs — переключение вкладок панели (ctx.openTab)
  let refreshHistory = null;
  let historyRequest = 0;
  const titleEl = h('h2');
  // тип записи над заголовком: в панели открываются и изделие, и задача, и заказ — по названию их не различить
  const kindOf = (r) => (typeof section.kind === 'function' ? section.kind(r) : section.kind) || ''; // kind — строка или (row) → строка (позиция / предложение)
  const kindEl = h('div', { class: 'drawer-kind', hidden: !kindOf(null) }, kindOf(null));
  const subEl = h('div', { class: 'muted small' });
  const hstEl = h('div', { class: 'k-head-slot' }); // card.headStats(row): значки справа от заголовка
  const stripEl = h('div', { class: 'k-head-strip' }); // card.headStrip(row): полоса под заголовком на всю ширину
  const upEl = h('button', { class: 'btn btn-sm drawer-up', type: 'button', hidden: true }); // ТИ-2: явный возврат «← Заказ №…»
  const menuBox = h('div', { class: 'rel' });
  const solo = isSolo() && !parent; const sid = section.id || ''; // в отдельном окне: панель на всё окно, ✕ закрывает окно
  const popBtn = parent || !sid || mode !== 'view' ? null : solo
    ? section.popout === false
      ? h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: reopenInPanel }, 'Открыть в панели')
      : h('button', { class: 'btn btn-ghost btn-sm', type: 'button', title: 'Следующие карточки будут открываться справа в основном окне', onclick: () => { setPopout(sid, false); window.close(); } }, 'Открывать в панели')
    : section.popout === false ? null
      : h('button', { class: 'btn btn-ghost btn-icon', type: 'button', title: 'Открыть в отдельном окне — его можно перенести на другой монитор; следующие карточки тоже откроются там', 'aria-label': 'В отдельном окне', onclick: () => { if (popout(sid)) tryClose(); else toast('Браузер не дал открыть окно — разрешите всплывающие окна для сайта', { error: true }); } }, '↗');
  const body = h('div', { class: 'drawer-body' });
  const foot = h('div', { class: 'drawer-foot' });
  const drawer = mark(h('aside', { class: 'drawer', role: 'dialog', 'aria-modal': 'true' },
    h('div', { class: 'drawer-head' }, h('div', { class: 't' }, upEl, kindEl, h('div', { class: 'k-head-row' }, titleEl, hstEl), subEl, stripEl), menuBox, popBtn,
      h('button', { class: 'btn btn-ghost btn-icon k-close', type: 'button', title: solo ? 'Закрыть окно' : 'Закрыть панель', 'aria-label': 'Закрыть', onclick: () => tryClose() }, '✕')),
    body, foot), 'drawer');
  makeResizable(drawer, { prefKey: 'detailW', edge: 'left', label: 'Ширина правой панели' }); // ШП
  const back = h('div', { class: 'drawer-back', onclick: () => tryClose() });
  const onKey = (e) => { if (!drawer.inert && e.key === 'Escape' && !solo && !document.querySelector('.modal-back')) tryClose(); };
  if (solo) { drawer.classList.add('solo'); back.hidden = true; soloGeometry(); }
  const applyDock = () => { if (drawer.inert) return; const d = docked(); drawer.classList.toggle('docked', d); back.hidden = d; drawer.setAttribute('aria-modal', d ? 'false' : 'true'); document.body.classList.toggle('detail-open', d); };
  document.addEventListener('keydown', onKey);
  window.addEventListener('resize', applyDock);
  document.body.append(back, drawer);
  applyDock();

  function destroy() { if (disposed) return; disposed = true; document.removeEventListener('keydown', onKey); window.removeEventListener('resize', applyDock); document.body.classList.remove('detail-open'); back.remove(); drawer.remove(); cardParent(drawer)?.destroy(); }
  async function canLeave() {
    if (saving || building || form?.busy?.() || (cardParent(drawer)?.child && !(await cardParent(drawer).child.canLeave()))) return false;
    return !form?.dirty() || await confirmDlg('Выйти без сохранения?', 'Изменения в форме не сохранены.', { okText: 'Выйти' });
  }
  async function tryClose() {
    if (!(await canLeave())) return;
    destroy(); ctx.close();
    if (solo && !parent) window.close();
  }
  function reopenInPanel() {
    if (saving || building || form?.busy?.() || form?.dirty() || cardParent(drawer)?.child) {
      toast('Завершите редактирование: сохраните или отмените изменения, затем откройте запись в панели.');
      return;
    }
    returnToPanel(sid);
  }

  // ---------- Просмотр ----------
  async function showView(fresh) {
    // панель-форма без карточки просмотра (состав, «изменить выбранные», бронь…): после «Сохранить»/«Отмена» — закрыть
    if (typeof section.card?.view !== 'function') { destroy(); ctx.close(); return; }
    form = null;
    menuBox.replaceChildren();
    foot.replaceChildren();
    if (!fresh && !row) { body.replaceChildren(h('div', { class: 'skel', style: { width: '60%' } }), h('p', { class: 'muted' }, 'Загрузка…')); }
    if (!fresh && row) drawer.classList.add('loading'); // соседняя запись: старое содержимое видно, пока грузится новое
    try { row = fresh || (await section.get(id)); }
    catch (e) { drawer.classList.remove('loading'); body.replaceChildren(failBlock(e, () => showView(), { text: 'Запись не открылась' })); titleEl.textContent = section.title; return; }
    drawer.classList.remove('loading');
    titleEl.replaceChildren(...parts(section.card.heading(row)));
    kindEl.textContent = kindOf(row); kindEl.hidden = !kindEl.textContent;
    subEl.replaceChildren(...parts(section.card.subheading ? section.card.subheading(row) : ''));
    hstEl.replaceChildren(...[section.card.headStats?.(row)].filter(Boolean)); hstEl.hidden = !hstEl.firstChild;
    const up = section.card.parent?.(row);
    upEl.hidden = !up;
    if (up) { upEl.textContent = '← ' + up.label; upEl.title = 'Вернуться: ' + up.label; upEl.onclick = () => up.run(); }
    const content = []; // [блок, зона по умолчанию]
    const zones = section.card.zones || {};
    const put = (el, def) => { if (el) content.push([el, el.dataset?.zone || zones[def] || (def === 'photo' ? 'side' : def === 'history' ? 'wide' : 'main')]); };
    const rare = [];
    if (section.card.top) put(section.card.top(row, actx()), 'top');
    const pics = section.card.gallery ? section.card.gallery(row) : [];
    const canPhoto = canEditSection(section) && section.card.photoAdd;
    const gal = pics.length ? gallery(pics, canPhoto && section.card.photoRemove ? async (p) => {
      if (!(await confirmDlg('Убрать фото?', 'Фото пропадёт из карточки.', { okText: 'Убрать' }))) return;
      try { actx().setRow(await section.card.photoRemove(row, p.id)); toast('Фото убрано'); } catch (e) { toastError(e); }
    } : null, canEditSection(section) && section.card.photoMain ? async (p) => {
      try { actx().setRow(await section.card.photoMain(row, p.id)); toast('Главное фото выбрано'); } catch (e) { toastError(e); }
    } : null) : null;
    // фото и зона загрузки — один блок: «Убрать фото» только при наличии фото, под зоной загрузки
    const drop = canPhoto ? photoDrop({ attach: (pid) => section.card.photoAdd(row, pid), done: (r) => { actx().setRow(r); toast('Фото добавлено'); }, searchText: section.card.photoSearch?.(row) }) : null;
    if (gal || drop) put(h('div', { 'data-zone': zones.photo || 'side' }, gal, drop, gal?.delBtn), 'photo');
    if (section.card.stats) put(h('div', { class: 'stats' }, section.card.stats(row).map(([l, v]) => h('div', { class: 'stat' }, h('b', { class: 'num' }, v), h('span', null, l)))), 'stats');
    let headActs = null;
    if (canEditSection(section) && section.card.actions) {
      // «Изменить» — одна, внизу панели (пользователь 2026-10-28: две кнопки — дубль); editTop больше не дублирует её сверху
      const acts = section.card.actions(row, actx()).filter(Boolean);
      if (acts.length) {
        // a.more — редкое действие уходит в единственное «⋯» шапки панели
        const mk = (a, cls) => h('button', { class: cls || 'btn' + (a.primary ? ' btn-primary' : ''), type: 'button', disabled: !!a.disabled, title: a.title || undefined, onclick: (e) => runAction(a, e.currentTarget) }, a.label);
        rare.push(...acts.filter((a) => a.more));
        const kids = acts.filter((a) => !a.more).map((a) => mk(a));
        // actionsInHead — кнопки в шапке справа под заголовком (заказ, 2026-11-08): блоку сведений — вся ширина
        if (kids.length && section.card.actionsInHead) headActs = h('div', { class: 'actions k-head-actions' }, kids);
        else if (kids.length) put(h('div', { class: 'actions' }, kids), 'actions');
      }
    }
    stripEl.replaceChildren(...[section.card.headStrip?.(row, actx()), headActs].filter(Boolean)); stripEl.hidden = !stripEl.firstChild;
    // Группы полей — по одной карточке в потоке (змейка на широкой панели), не одним столбом слева.
    const fieldEl = readonlyGroups(section.card.view(row, actx()) || []);
    if (fieldEl?.classList?.contains('k-readonly-groups')) [...fieldEl.children].forEach((g) => put(g, 'fields'));
    else put(fieldEl, 'fields');
    if (section.card.extra) put(section.card.extra(row, actx()), 'extra');
    // T9 (C052): card.tabs — вкладки панели. Аддитивно: только если раздел задал section.card.tabs; сведения (view) и кнопки — над вкладками.
    const tabDefs = section.card.tabs ? (section.card.tabs(row, actx()) || []).filter((t) => !t.when || t.when(row)) : [];
    const hasTabs = tabDefs.length > 0;
    openTab = null;
    drawer.querySelector(':scope > [role=tablist]')?.remove(); // прежняя полоса вкладок (перезагрузка записи)
    if (hasTabs) {
      const tb = buildCardTabs({ tabDefs, section, row, actx, setPref, getPref, onOpenTab: (fn) => { openTab = fn; } });
      put(tb, 'main');
      // вкладки — вплотную под шапкой, вне прокрутки: не уезжают и не дрожат (владелец 15.11)
      // только если над вкладками в карточке ничего нет (заказ): иначе «Что дальше» изделия уехало бы под вкладки
      const bar = tb.querySelector('[role=tablist]');
      const nothingAbove = () => [...body.children].every((c) => c.contains(tb) || !c.textContent.trim());
      if (bar && !solo) setTimeout(() => { if (bar.isConnected && nothingAbove()) body.before(bar); }, 0);
    }
    const histUl = section.card.noHistory ? null : h('ul', { class: 'timeline' }, busyBlock('историю', { tag: 'li', cls: 'muted' }));
    const histWrap = histUl ? h('details', { class: 'db-blk', hidden: true }, h('summary', null, 'История изменений'), histUl) : null; // история — внизу, всегда свёрнута (ПМ-1)
    put(histWrap, 'history');
    body.replaceChildren(...arrange(content, hasTabs));
    ctx.viewed?.(row, titleEl.textContent, kindOf(row));
    const historyRow = row;
    refreshHistory = histUl ? () => loadHistory(histUl, histWrap, historyRow) : null;
    refreshHistory?.();

    if (canEditSection(section) && section.form && (!section.card.editable || section.card.editable(row))) foot.append(h('button', { class: 'btn btn-primary', type: 'button', onclick: () => showForm('edit') }, section.card.editLabel || 'Изменить'));
    buildMenu(rare, hasTabs);
  }
  function arrange(content, forceOne = false) {
    const mode = forceOne ? 'one' : layoutNow();
    if (mode === 'one') return content.map(([el]) => el);
    const flow = [], bottom = [];
    for (const [el, z] of content) {
      if (z === 'history' || (mode === 'wide' && z === 'wide')) bottom.push(el);
      else flow.push(el);
    }
    if (flow.length < 2 && !bottom.length) return content.map(([el]) => el);
    return [h('div', { class: 'dz-box' },
      flow.length ? h('div', { class: 'dz-flow', 'data-layout': mode }, ...flow) : null,
      bottom.length ? h('div', { class: 'dz-flow-wide' }, ...bottom) : null)];
  }
  const buildMenu = (rare, hasTabs = false) => fillCardMenu({
    menuBox, rare, hasTabs, layouts: LAYOUTS, layoutNow, section, row, body, showView, showForm, doRemove, runAction,
  });

  async function loadHistory(ul, wrap, record) {
    if (!section.entityType || !record?.id) { ul.replaceChildren(); return; }
    const request = ++historyRequest;
    try {
      const r = await api('/audit-logs/record', { query: { entityType: section.entityType, entityId: record.id } });
      const rows = section.card.historyItems ? await section.card.historyItems(record, r.items) : r.items;
      if (request !== historyRequest) return;
      if (!rows.length) { ul.replaceChildren(); wrap.hidden = true; return; }
      const label = section.historyLabels || {};
      let names = {}; let flds = [];
      try { flds = (section.form?.fields ? await section.form.fields(record) : []).filter((f) => f.key); names = Object.fromEntries(flds.map((f) => [f.key, f.label])); } catch { /* без подписей */ }
      // И.3 «Вернуть как было»: поля этого изменения, которые есть в форме, — прежние значения в форму правки; сохраняет человек
      const byKey = new Map(flds.map((f) => [f.key, f]));
      const revertOf = (x) => (x.first || !canEditSection(section) || section.form?.build ? [] : (x.changes || []).filter((c) => byKey.has(c.field) && byKey.get(c.field).type !== 'widget' && byKey.get(c.field).type !== 'photos'));
      const items = rows.filter((x) => usefulEntry(x, names));
      if (request !== historyRequest) return;
      if (!items.length) { ul.replaceChildren(); wrap.hidden = true; return; }
      ul.replaceChildren(...items.map((x) => h('li', null, h('span', { class: 'when' }, dateTime(x.createdAt)), h('span', null, x.label || label[x.action] || actionLabel(x.action)), h('span', { class: 'muted' }, x.userName || ''),
        changeList(x.changes, names, x.first),
        String(x.action || '').endsWith('deleted') && session.canEdit ? h('a', { href: '#trash', class: 'btn btn-ghost btn-sm', title: 'Открыть корзину: там запись можно вернуть', onclick: (e) => { e.preventDefault(); go('trash'); } }, 'В корзине — восстановить') : null,
        revertOf(x).length ? h('button', { type: 'button', class: 'btn btn-ghost btn-sm', title: 'Открыть правку с прежними значениями этих полей — проверьте и сохраните', onclick: () => {
          const back = revertOf(x);
          const values = Object.fromEntries(back.map((c) => [c.field, byKey.get(c.field).type === 'date' && c.from ? String(c.from).slice(0, 10) : c.from ?? '']));
          showForm('edit', null, { values, note: `Как было до изменения от ${dateTime(x.createdAt)}: ${back.map((c) => names[c.field] || c.field).join(', ')}. Проверьте и нажмите «Сохранить».` });
        } }, 'Вернуть как было') : null)));
      if (wrap) wrap.hidden = false;
    } catch { if (request === historyRequest) { ul.replaceChildren(h('li', { class: 'muted' }, 'История недоступна')); wrap.hidden = false; } }
  }

  function actx() {
    return {
      beginInlineEdit: () => {
        const editButton = foot.querySelector('.btn-primary'); if (!editButton) return () => {};
        inlineEdits.set(editButton, (inlineEdits.get(editButton) || 0) + 1); editButton.hidden = true;
        let released = false;
        return () => { if (released) return; released = true; const rest = (inlineEdits.get(editButton) || 1) - 1; inlineEdits.set(editButton, rest); if (!rest) editButton.hidden = false; };
      },
      edit: async (draft) => { if (await canLeave()) return showForm('edit', draft); },
      reload: async () => { if (await canLeave()) return showView(); },
      setRow: (r) => { if (!disposed) { const shown = showView(r); ctx.changed(); return shown; } }, changed: ctx.changed, close: tryClose,
      refreshHistory: () => { if (!disposed) return refreshHistory?.(); },
      openTab: (key) => { openTab?.(key); },
      run: async (fn) => { if (!(await canLeave())) return false; saving = true; try { await fn(); return true; } finally { saving = false; } },
    };
  }
  async function runAction(a, btn) {
    // дольше четверти секунды — крутилка на кнопке: видно, что дело идёт (замечание 2026-10-22 «тишина»); ОШ2.5 — ui/busy.js
    const done = busyBtn(btn, null, { delay: 250 });
    try { await a.run(row, actx()); } catch (e) { toastError(e, typeof a.label === 'string' ? a.label : ''); } finally { done(); }
  }

  async function doRemove() {
    const why = section.remove.blocked ? section.remove.blocked(row) : null;
    if (why) { toast(why, { error: true }); return; }
    if (!(await confirmDlg('Удалить?', section.remove.text(row) + (section.remove.noTrash ? ' Вернуть можно сразу: кнопка «Отменить» после удаления.' : ' Можно восстановить из корзины.'), { okText: 'Удалить', danger: true }))) return;
    try {
      // ТИ-4: не-админ вводит свой пароль (раздел помечен remove.password)
      if (section.remove.password) { if ((await withConfirm(async () => { await section.remove.run(row); return true; }, { text: 'Удаление требует вашего пароля.' })) === null) return; }
      else await section.remove.run(row);
      const removed = row;
      destroy(); ctx.close(); ctx.changed();
      toast('Удалено', { undo: async () => { try { await (section.remove.password ? withConfirm(() => section.remove.restore(removed), { text: 'Восстановление требует вашего пароля.' }) : section.remove.restore(removed)); toast('Восстановлено'); ctx.changed(); } catch (e) { toastError(e); } } });
    } catch (e) { toastError(e); }
  }

  // ---------- Правка / создание ----------
  async function showForm(m, init, revert) {
    const isNew = m === 'create';
    if (saving || building || disposed) return;
    building = true;
    let base0;
    try { base0 = isNew ? (await init) || (section.form.initial ? await section.form.initial() : {}) : { ...(section.form.toInitial ? section.form.toInitial(row) : row), ...(init || {}) }; }
    catch (e) { building = false; body.replaceChildren(failBlock(e, () => showForm(m, init, revert), { text: 'Форма не открылась' })); return; }
    const base = revert ? { ...base0, ...revert.values } : base0; // И.3: прежние значения поверх текущих
    menuBox.replaceChildren();
    // заголовок — «что и о чём»: «Изделие · 32.11 Скамья», а не «Изменить»; режим — мелкой строкой ниже
    const who = isNew ? [] : parts(section.card.heading(row));
    const what = kindOf(row) || section.title;
    const custom = isNew ? null : section.card.editTitle?.(row);
    if (isNew) titleEl.replaceChildren(section.newTitle || 'Новая запись');
    else if (custom) titleEl.replaceChildren(...parts(custom));
    else titleEl.replaceChildren(...(what && String(who[0]) !== what ? [what, ' · ', ...who] : who));
    subEl.replaceChildren(isNew ? '' : (section.card.editSub?.(row) || 'изменение'));
    body.replaceChildren(h('div', { class: 'skel', style: { width: '60%' } }), h('p', { class: 'muted' }, 'Загрузка…'));
    foot.replaceChildren();
    let flds;
    try {
      if (section.form.build) form = await section.form.build(base, actx()); // своя форма раздела (счёт с позициями)
      else { flds = await section.form.fields(isNew ? null : row); form = buildForm(flds, base); }
    } catch (e) { body.replaceChildren(failBlock(e, () => showForm(m, init, revert), { text: 'Форма не открылась' })); return; }
    finally { building = false; }
    if (disposed) return;
    const err = h('div', { class: 'form-error', hidden: true });
    body.replaceChildren(...[err, revert ? h('div', { class: 'fill-note' }, revert.note) : null, form.el].filter(Boolean));
    let saveLabel = section.form.saveLabel || (isNew ? 'Создать' : 'Сохранить');
    const save = h('button', { class: 'btn btn-primary', type: 'button' }, saveLabel);
    // форма сама управляет кнопкой: неактивна, пока нечего сохранять; подпись по выбору («Выдать 3 позиции») — SK-6c
    form.bindSave?.((enabled, label) => { save.disabled = !enabled; if (label) { saveLabel = label; save.textContent = label; } });
    const cancel = h('button', { class: 'btn', type: 'button', onclick: async () => {
      if (saving || building || form?.busy?.()) return;
      const closingForm = form;
      if (!closingForm) return;
      if (closingForm.readonly && closingForm.beforeClose) {
        saving = true;
        try { await closingForm.beforeClose(); }
        catch (e) { toastError(e, 'сохранить'); return; }
        finally { saving = false; }
      }
      if (disposed || form !== closingForm) return;
      if (closingForm.dirty() && !(await confirmDlg('Отменить изменения?', 'Введённые данные не сохранятся.', { okText: 'Да, отменить' }))) return;
      if (isNew && !row) { destroy(); ctx.close(); } else return showView(row);
    } }, 'Отмена');
    save.onclick = async () => {
      let saved;
      const previousId = id;
      if (save.disabled) return;
      if (saving || form?.busy?.()) return;
      const done = busyBtn(save, 'Сохраняю…'); err.hidden = true;
      saving = true; cancel.disabled = true;
      const controls = [...body.querySelectorAll('input,textarea,select,button')].map((el) => ({ el, disabled: el.disabled }));
      controls.forEach(({ el }) => { el.disabled = true; });
      const unlock = () => controls.forEach(({ el, disabled }) => { el.disabled = disabled; });
      try {
        const r = form.read();
        if (r.errors) { saving = false; cancel.disabled = false; unlock(); done(); return; }
        const bodyData = section.form.toBody(r.values, isNew ? null : row);
        saved = isNew ? await section.form.create(bodyData) : await section.form.update(row.id, bodyData, row); // row — для версии записи (C049-1)
      } catch (e) {
        // ОШ2.4: сбой — «Не удалось сохранить: нет связи… Проверьте интернет…»; ответ сервера — «Не сохранено: Укажите…»
        reportError(e, { action: isNew ? 'создать запись' : 'сохранить' });
        err.textContent = isFailure(e) ? actionText(isNew ? 'создать запись' : 'сохранить', e) : 'Не сохранено: ' + errText(e); err.hidden = false;
        if (e?.fields) form.markErrors?.(e.fields);
        form.onError?.(e);
        saving = false; cancel.disabled = false; unlock();
        done(); if (form.conflicted) save.disabled = true; save.textContent = saveLabel;
        return;
      }
      // после успешного сохранения — вне try: сбой показа не выдаётся за «Не сохранено» (и повтор не создаст дубль)
      saving = false;
      form = null;
      // панель осталась открытой (отчёт внутри формы: спецификация) — только «Закрыть»
      if (saved && saved.stay) {
        ctx.changed(); window.dispatchEvent(new CustomEvent('data-changed'));
        foot.replaceChildren(h('button', { class: 'btn btn-primary', type: 'button', onclick: () => { destroy(); ctx.close(); } }, 'Закрыть'));
        return;
      }
      if (section.form.closeAfterCreate) { ctx.changed(); window.dispatchEvent(new CustomEvent('data-changed')); destroy(); ctx.close(); return; }
      toast(isNew ? 'Создано' : 'Сохранено');
      ctx.changed();
      id = saved.id;
      // Ошибка перехода после записи не превращает успешный API-save в «Не сохранено».
      try {
        if (await section.form.afterSave?.(saved, { previousId, isNew }) === true) return;
      } catch (e) { reportError(e, { action: 'открыть сохранённую запись' }); toastError(e, 'открыть сохранённую запись'); }
      if (isNew) ctx.opened?.(saved.id);
      showView(saved);
    };
    // readonly: одна кнопка (doneLabel или «Закрыть»); beforeClose пишет отложенные умолчания до возврата к карточке
    if (form.readonly) {
      cancel.textContent = form.doneLabel || 'Закрыть';
      if (form.doneLabel) cancel.classList.add('btn-primary');
      // h() регистрирует onclick через addEventListener: второй onclick здесь вызвал бы закрытие дважды.
      foot.replaceChildren(...[].concat(form.foot || []).filter(Boolean), cancel); // C112 Ф1: form.foot — закреплённая полоса «Осталось N … → Выпустить» слева от «Закрыть»
    } else foot.replaceChildren(save, cancel);
    // ИЗ-13: без автофокуса при открытии — курсор ставит сам человек (фокус только на поле с ошибкой)
  }

  // «Требуют заполнения» (TASKS ТЗ.3): fill=<ключ поля> — сразу правка, нужное поле подсвечено, раскрыто и в фокусе
  function markFill(key) {
    const input = body.querySelector(`[name="${key}"]`);
    const label = input?.closest('.field');
    if (!label) { body.prepend(h('div', { class: 'fill-note' }, 'Это поле здесь не заполняется — посмотрите подсказку в списке «Требуют заполнения».')); return; }
    label.closest('.closed')?.classList.remove('closed');
    label.classList.add('fill-here');
    body.prepend(h('div', { class: 'fill-note' }, 'Заполните: ', h('b', null, (label.querySelector('span')?.textContent || '').replace(/\s*\*$/, '')), ' — поле подсвечено. Затем «Сохранить».'));
    label.scrollIntoView({ block: 'center' });
    setTimeout(() => input.focus(), 50);
  }
  if (mode === 'create') showForm('create', initial);
  else if (fill && section.form && canEditSection(section)) showView().then(() => (row ? showForm('edit') : null)).then(() => { if (form && fill !== 'edit') markFill(fill); });
  // card.startEdit(row) — открыть сразу правкой (текст пункта паспорта: панель = поле ввода)
  else if (section.card.startEdit && section.form && canEditSection(section)) showView().then(() => (row && section.card.startEdit(row) ? showForm('edit') : null));
  else showView();
  const handle = {
    close: destroy,
    canLeave,
    get saving() { return !!cardParent(drawer)?.child?.saving || saving || building || !!form?.busy?.(); },
    /** Другая запись в той же панели. false — если в форме несохранённые правки и пользователь остался. */
    async load(nextId) {
      if (!(await canLeave())) return false;
      id = nextId; menuBox.replaceChildren();
      await showView();
      // панель-правка (справочники): другая запись открывается сразу правкой, как первая
      if (section.card.startEdit && section.form && canEditSection(section) && row && section.card.startEdit(row)) showForm('edit');
      body.scrollTop = 0;
      return true;
    },
    get editing() { return !!form; },
    /** В форме несохранённые правки (НВ.4: «Назад» спросит «Выйти без сохранения?»). */
    isDirty: () => !!cardParent(drawer)?.child || saving || building || !!form?.busy?.() || !!(form && form.dirty()),
  };
  return registerCardParent(drawer, body, back, parent, handle, applyDock, () => disposed);
}
