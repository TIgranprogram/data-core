import { api, canEditSection, PREFIX } from '../core/api.js';
import { h } from '../core/dom.js';
import { dateTime } from '../core/format.js';
import { actionLabel, changeList } from './history.js';
import { confirmDlg } from './dialog.js';
import { photoDrop } from './photos.js';
import { buildForm } from './form.js';
import { toast, toastError } from './toast.js';
import { actionText, errText, isFailure } from './errors.js';
import { busyBlock, busyBtn, failBlock } from './busy.js';
import { makeResizable } from './resizer.js';
import { DOCK_MIN } from '../core/prefs.js';

/**
 * Карточка записи — боковая панель (CANON §2). Режимы: просмотр / правка / создание.
 * section = {
 *   title, entityType, noun ('заявку'), get(id) → row,
 *   card: { heading(row), subheading?(row), stats?(row), view(row) → [[подпись, значение]], actions?(row, ctx), extra?(row, ctx),
 *           startEdit?(row) → true — открыть сразу в правке, noHistory — без «Истории изменений»,
 *           gallery?(row) → [{ id, url, thumb }], photoAdd?(row, photoId) → row, photoRemove?(row, photoId) → row },
 *   form?: { fields(row|null) → поля, toBody(values, row|null), create(body) → row, update(id, body) → row, initial?() },
 *   remove?: { run(row), restore(row), text(row), blocked?(row) → причина | null },
 *   duplicate?(row) → начальные значения новой записи,
 * }
 * ctx: { close(), changed() — перерисовать список }.
 * На широком экране (≥ DOCK_MIN) карточка «пристыкована» справа рядом со списком: без затемнения, список виден и кликается.
 * load(id) — показать другую запись в той же панели (стрелки ↑/↓ в списке), без закрытия-открытия.
 */

/** Фото записи: большое + миниатюры; клик — на весь экран (Esc / клик — закрыть). pics: [{ url, thumb }] */
function gallery(pics, onRemove) {
  const big = h('img', { class: 'g-big', src: PREFIX + pics[0].url, alt: '', loading: 'lazy' });
  let cur = 0;
  const show = (i) => { cur = i; big.src = PREFIX + pics[i].url; strip.querySelectorAll('img').forEach((x, j) => x.classList.toggle('active', j === i)); };
  const strip = pics.length > 1 ? h('div', { class: 'g-strip' }, pics.map((p, i) => h('img', { src: PREFIX + (p.thumb || p.url), alt: '', class: i ? '' : 'active', onclick: () => show(i) }))) : h('div');
  big.addEventListener('click', () => {
    const box = h('div', { class: 'lightbox', role: 'dialog', 'aria-label': 'Фото' }, h('img', { src: PREFIX + pics[cur].url, alt: '' }));
    const close = (e) => { if (!e || e.type === 'click' || e.key === 'Escape') { box.remove(); document.removeEventListener('keydown', close, true); e?.stopPropagation?.(); } };
    box.addEventListener('click', close);
    document.addEventListener('keydown', close, true);
    document.body.append(box);
  });
  const del = onRemove ? h('button', { class: 'btn btn-ghost btn-sm g-del', type: 'button', title: 'Убрать это фото из карточки', onclick: (e) => { e.stopPropagation(); onRemove(pics[cur]); } }, 'Убрать фото') : null;
  return h('div', { class: 'gallery' }, big, strip, del);
}
const docked = () => window.innerWidth >= DOCK_MIN;
export function openCard(section, { id, mode = 'view', initial, fill }, ctx) {
  let row = null;
  let form = null;
  const titleEl = h('h2');
  const subEl = h('div', { class: 'muted small' });
  const menuBox = h('div', { class: 'rel' });
  const body = h('div', { class: 'drawer-body' });
  const foot = h('div', { class: 'drawer-foot' });
  const drawer = h('aside', { class: 'drawer', role: 'dialog', 'aria-modal': 'true' },
    h('div', { class: 'drawer-head' }, h('div', { class: 't' }, titleEl, subEl), menuBox,
      h('button', { class: 'btn btn-ghost btn-icon', type: 'button', title: 'Закрыть', 'aria-label': 'Закрыть', onclick: () => tryClose() }, '✕')),
    body, foot);
  makeResizable(drawer, { prefKey: 'detailW', edge: 'left', label: 'Ширина правой панели' }); // ШП
  const back = h('div', { class: 'drawer-back', onclick: () => tryClose() });
  const onKey = (e) => { if (e.key === 'Escape' && !document.querySelector('.modal-back')) tryClose(); };
  const applyDock = () => { const d = docked(); drawer.classList.toggle('docked', d); back.hidden = d; drawer.setAttribute('aria-modal', d ? 'false' : 'true'); document.body.classList.toggle('detail-open', d); };
  document.addEventListener('keydown', onKey);
  window.addEventListener('resize', applyDock);
  document.body.append(back, drawer);
  applyDock();

  function destroy() { document.removeEventListener('keydown', onKey); window.removeEventListener('resize', applyDock); document.body.classList.remove('detail-open'); back.remove(); drawer.remove(); }
  async function tryClose() {
    if (form && form.dirty() && !(await confirmDlg('Выйти без сохранения?', 'Изменения в форме не сохранены.', { okText: 'Выйти' }))) return;
    destroy(); ctx.close();
  }

  // ---------- Просмотр ----------
  async function showView(fresh) {
    // панель-форма без карточки просмотра (состав, «изменить выбранные», бронь…): после «Сохранить»/«Отмена» — закрыть
    if (typeof section.card?.view !== 'function') { destroy(); ctx.close(); return; }
    form = null;
    menuBox.replaceChildren();
    foot.replaceChildren();
    if (!fresh && !row) { body.replaceChildren(h('div', { class: 'skel', style: { width: '60%' } })); }
    if (!fresh && row) drawer.classList.add('loading'); // соседняя запись: старое содержимое видно, пока грузится новое
    try { row = fresh || (await section.get(id)); }
    catch (e) { drawer.classList.remove('loading'); body.replaceChildren(failBlock(e, () => showView(), { text: 'Запись не открылась' })); titleEl.textContent = section.title; return; }
    drawer.classList.remove('loading');
    titleEl.textContent = section.card.heading(row);
    subEl.textContent = section.card.subheading ? section.card.subheading(row) : '';
    const content = [];
    const pics = section.card.gallery ? section.card.gallery(row) : [];
    const canPhoto = canEditSection(section) && section.card.photoAdd;
    if (pics.length) content.push(gallery(pics, canPhoto && section.card.photoRemove ? async (p) => {
      if (!(await confirmDlg('Убрать фото?', 'Фото пропадёт из карточки.', { okText: 'Убрать' }))) return;
      try { actx().setRow(await section.card.photoRemove(row, p.id)); toast('Фото убрано'); } catch (e) { toastError(e); }
    } : null));
    if (canPhoto) content.push(photoDrop({ attach: (pid) => section.card.photoAdd(row, pid), done: (r) => { actx().setRow(r); toast('Фото добавлено'); } }));
    if (section.card.stats) content.push(h('div', { class: 'stats' }, section.card.stats(row).map(([l, v]) => h('div', { class: 'stat' }, h('b', { class: 'num' }, v), h('span', null, l)))));
    if (canEditSection(section) && (section.card.actions || (section.card.editTop && section.form))) {
      // editTop — «Изменить» первой кнопкой сверху (СП.1: внизу её не замечают)
      const acts = [section.card.editTop && section.form ? { label: 'Изменить', primary: true, run: () => showForm('edit') } : null, ...(section.card.actions ? section.card.actions(row, actx()) : [])].filter(Boolean);
      if (acts.length) content.push(h('div', { class: 'actions' }, acts.map((a) => h('button', { class: 'btn' + (a.primary ? ' btn-primary' : ''), type: 'button', disabled: !!a.disabled, title: a.title || undefined, onclick: (e) => runAction(a, e.currentTarget) }, a.label))));
    }
    content.push(h('dl', { class: 'fields' }, section.card.view(row).filter(([, v]) => v !== undefined && v !== null && v !== '').flatMap(([l, v]) => [h('dt', null, l), h('dd', null, v)])));
    if (section.card.extra) content.push(section.card.extra(row, actx()));
    // noHistory — у записи нет своей истории (пункт текста паспорта: история — у версии шаблона)
    const histUl = section.card.noHistory ? null : h('ul', { class: 'timeline' }, busyBlock('историю', { tag: 'li', cls: 'muted' }));
    const histWrap = histUl ? h('div', { hidden: true }, h('div', { class: 'section-title' }, 'История изменений'), histUl) : null;
    if (histWrap) content.push(histWrap);
    body.replaceChildren(...content);
    if (histUl) loadHistory(histUl, histWrap);

    if (canEditSection(section)) {
      if (section.form) foot.append(h('button', { class: 'btn btn-primary', type: 'button', onclick: () => showForm('edit') }, 'Изменить'));
      const items = [];
      if (section.duplicate && section.form) items.push(h('button', { type: 'button', onclick: () => { closeMenu(); showForm('create', section.duplicate(row)); } }, 'Дублировать'));
      if (section.remove) items.push(h('button', { type: 'button', class: 'danger', onclick: () => { closeMenu(); doRemove(); } }, 'Удалить'));
      if (items.length) {
        const menu = h('div', { class: 'menu', hidden: true }, items);
        const toggle = h('button', { class: 'btn btn-ghost btn-icon', type: 'button', title: 'Ещё', 'aria-label': 'Ещё действия', onclick: () => { menu.hidden = !menu.hidden; } }, '⋯');
        menuBox.append(toggle, menu);
      }
    }
  }
  const closeMenu = () => { const m = menuBox.querySelector('.menu'); if (m) m.hidden = true; };

  async function loadHistory(ul, wrap) {
    if (!section.entityType || !row?.id) { return; }
    try {
      const r = await api('/audit-logs/record', { query: { entityType: section.entityType, entityId: row.id } });
      if (!r.items.length) return; // скрываем секцию если истории нет
      const label = section.historyLabels || {};
      // подписи полей — из формы раздела (И.1: «Поле: было → стало»)
      let names = {}; let flds = [];
      try { flds = (section.form?.fields ? await section.form.fields(row) : []).filter((f) => f.key); names = Object.fromEntries(flds.map((f) => [f.key, f.label])); } catch { /* без подписей */ }
      // И.3 «Вернуть как было»: поля этого изменения, которые есть в форме, — прежние значения в форму правки; сохраняет человек
      const byKey = new Map(flds.map((f) => [f.key, f]));
      const revertOf = (x) => (x.first || !canEditSection(section) || section.form?.build ? [] : (x.changes || []).filter((c) => byKey.has(c.field) && byKey.get(c.field).type !== 'widget' && byKey.get(c.field).type !== 'photos'));
      ul.replaceChildren(...r.items.map((x) => h('li', null, h('span', { class: 'when' }, dateTime(x.createdAt)), h('span', null, label[x.action] || actionLabel(x.action)), h('span', { class: 'muted' }, x.userName || ''),
        changeList(x.changes, names, x.first),
        revertOf(x).length ? h('button', { type: 'button', class: 'btn btn-ghost btn-sm', title: 'Открыть правку с прежними значениями этих полей — проверьте и сохраните', onclick: () => {
          const back = revertOf(x);
          const values = Object.fromEntries(back.map((c) => [c.field, byKey.get(c.field).type === 'date' && c.from ? String(c.from).slice(0, 10) : c.from ?? '']));
          showForm('edit', null, { values, note: `Как было до изменения от ${dateTime(x.createdAt)}: ${back.map((c) => names[c.field] || c.field).join(', ')}. Проверьте и нажмите «Сохранить».` });
        } }, 'Вернуть как было') : null)));
      if (wrap) wrap.hidden = false;
    } catch { ul.replaceChildren(h('li', { class: 'muted' }, 'История недоступна')); if (wrap) wrap.hidden = false; }
  }

  function actx() {
    return { reload: () => showView(), setRow: (r) => { showView(r); ctx.changed(); }, changed: ctx.changed, close: () => { destroy(); ctx.close(); } };
  }
  async function runAction(a, btn) {
    // дольше четверти секунды — крутилка на кнопке: видно, что дело идёт (замечание 2026-10-22 «тишина»); ОШ2.5 — ui/busy.js
    const done = busyBtn(btn, null, { delay: 250 });
    try { await a.run(row, actx()); } catch (e) { toastError(e, typeof a.label === 'string' ? a.label : ''); } finally { done(); }
  }

  async function doRemove() {
    const why = section.remove.blocked ? section.remove.blocked(row) : null;
    if (why) { toast(why, { error: true }); return; }
    if (!(await confirmDlg('Удалить?', section.remove.text(row) + ' Её можно будет восстановить из корзины.', { okText: 'Удалить', danger: true }))) return;
    try {
      await section.remove.run(row);
      const removed = row;
      destroy(); ctx.close(); ctx.changed();
      toast('Удалено', { undo: async () => { try { await section.remove.restore(removed); toast('Восстановлено'); ctx.changed(); } catch (e) { toastError(e); } } });
    } catch (e) { toastError(e); }
  }

  // ---------- Правка / создание ----------
  async function showForm(m, init, revert) {
    const isNew = m === 'create';
    const base0 = isNew ? (await init) || (section.form.initial ? await section.form.initial() : {}) : section.form.toInitial ? section.form.toInitial(row) : row;
    const base = revert ? { ...base0, ...revert.values } : base0; // И.3: прежние значения поверх текущих
    menuBox.replaceChildren();
    titleEl.textContent = isNew ? section.newTitle || 'Новая запись' : 'Изменить';
    subEl.textContent = isNew ? '' : section.card.heading(row);
    body.replaceChildren(h('div', { class: 'skel', style: { width: '60%' } }));
    foot.replaceChildren();
    let flds;
    try {
      if (section.form.build) form = await section.form.build(base); // своя форма раздела (счёт с позициями)
      else { flds = await section.form.fields(isNew ? null : row); form = buildForm(flds, base); }
    } catch (e) { body.replaceChildren(failBlock(e, () => showForm(m, init, revert), { text: 'Форма не открылась' })); return; }
    const err = h('div', { class: 'form-error', hidden: true });
    body.replaceChildren(...[err, revert ? h('div', { class: 'fill-note' }, revert.note) : null, form.el].filter(Boolean));
    let saveLabel = section.form.saveLabel || (isNew ? 'Создать' : 'Сохранить');
    const save = h('button', { class: 'btn btn-primary', type: 'button' }, saveLabel);
    // форма сама управляет кнопкой: неактивна, пока нечего сохранять; подпись по выбору («Выдать 3 позиции») — SK-6c
    form.bindSave?.((enabled, label) => { save.disabled = !enabled; if (label) { saveLabel = label; save.textContent = label; } });
    const cancel = h('button', { class: 'btn', type: 'button', onclick: async () => {
      if (form.dirty() && !(await confirmDlg('Отменить изменения?', 'Введённые данные не сохранятся.', { okText: 'Да, отменить' }))) return;
      if (isNew && !row) { destroy(); ctx.close(); } else showView(row);
    } }, 'Отмена');
    save.onclick = async () => {
      let saved;
      if (save.disabled) return;
      const r = form.read();
      if (r.errors) return;
      const done = busyBtn(save, 'Сохраняю…'); err.hidden = true;
      try {
        const bodyData = section.form.toBody(r.values, isNew ? null : row);
        saved = isNew ? await section.form.create(bodyData) : await section.form.update(row.id, bodyData);
      } catch (e) {
        // ОШ2.4: сбой — «Не удалось сохранить: нет связи… Проверьте интернет…»; ответ сервера — «Не сохранено: Укажите…»
        err.textContent = isFailure(e) ? actionText(isNew ? 'создать запись' : 'сохранить', e) : 'Не сохранено: ' + errText(e); err.hidden = false;
        if (e?.fields) form.markErrors?.(e.fields);
        done(); save.textContent = saveLabel;
        return;
      }
      // после успешного сохранения — вне try: сбой показа не выдаётся за «Не сохранено» (и повтор не создаст дубль)
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
      if (isNew) ctx.opened?.(saved.id);
      showView(saved);
    };
    // form.readonly — только просмотр (нет права записи): одна кнопка «Закрыть»
    if (form.readonly) { cancel.textContent = 'Закрыть'; foot.replaceChildren(cancel); } else foot.replaceChildren(save, cancel);
    form.focus();
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
  else if (fill && section.form && canEditSection(section)) showView().then(() => (row ? showForm('edit') : null)).then(() => { if (form) markFill(fill); });
  // card.startEdit(row) — открыть сразу правкой (текст пункта паспорта: панель = поле ввода)
  else if (section.card.startEdit && section.form && canEditSection(section)) showView().then(() => (row && section.card.startEdit(row) ? showForm('edit') : null));
  else showView();
  return {
    close: destroy,
    /** Другая запись в той же панели. false — если в форме несохранённые правки и пользователь остался. */
    async load(nextId) {
      if (form && form.dirty() && !(await confirmDlg('Выйти без сохранения?', 'Изменения в форме не сохранены.', { okText: 'Выйти' }))) return false;
      id = nextId; menuBox.replaceChildren();
      await showView();
      // панель-правка (справочники): другая запись открывается сразу правкой, как первая
      if (section.card.startEdit && section.form && canEditSection(section) && row && section.card.startEdit(row)) showForm('edit');
      body.scrollTop = 0;
      return true;
    },
    get editing() { return !!form; },
    /** В форме несохранённые правки (НВ.4: «Назад» спросит «Выйти без сохранения?»). */
    isDirty: () => !!(form && form.dirty()),
  };
}
