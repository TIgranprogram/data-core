/**
 * C134/C141: паспорт «как в PDF» — эталон правки. Поле правится на листе (inline); справа — ИИ и подсказка.
 * Модули: book-blocks (страницы), book-choices (воронка), book-focus (очередь), book-images, book-shared.
 * Жизненный цикл: одно открытое поле; перерисовка сохраняет черновик; запись — под замком паспорта.
 */
import { api, session } from '../../core/api.js';
import { h } from '../../core/dom.js';
import { toast, toastError } from '../../ui/kit/toast.js';
import { confirmDlg } from '../../ui/kit/dialog.js';
import { button, badge, select, iconButton } from '../../ui/kit/index.js';
import { buildForm } from '../../ui/kit/form.js';
import { srcLegend } from '../../ui/kit/src.js';
import { canEdit, canWorkPassport, heading, numberOf, ourCompanies, statusOf } from './common.js';
import { passportAction } from './field-edit.js';
import { pickSourceKey, aiCheckBlock, pageText, exclusive, sidePanel } from './book-shared.js';
import { buildBook } from './book-blocks.js';
import { loadCompositionTree } from './book-composition-tree.js';
import { mountBookChoices } from './book-choices.js';
import { mountBookFocus } from './book-focus.js';
import { imageStrip } from './book-images.js';
import { ilogicBlock } from './book-ilogic.js';
import { printDialog } from './dialogs.js';
import { SRC_LABEL } from './card-blocks.js';

const hhmm = () => new Date().toTimeString().slice(0, 5);

/** Открыть окно паспорта. onClose(row, changed) — после закрытия. */
export async function openBookEditor(passport, { onClose } = {}) {
  let row;
  try { row = await api('/passports/' + (passport.id || passport)); } catch (e) { toastError(e); return; }
  const S = { r: row, changed: false, cur: null, fit: true };
  // править можно, если есть право на работу с паспортами и он не аннулирован; номер изделия — только администратор/владелец (как на сервере)
  const can = canWorkPassport() && statusOf(row) !== 'annulled';
  const canNumber = session.role === 'admin' || session.user?.isOwner === true;
  const pid = () => S.r.id;
  const lock = (fn) => exclusive(pid(), passportAction, fn);

  // ─── каркас окна ────────────────────────────────────────────────────────────
  const stat = h('span', { class: 'bk-stat', 'aria-live': 'polite' }, 'Правки сохраняются сразу при нажатии «Сохранить».');
  const tocPagesList = h('div', { class: 'bk-toc-pages-list', 'aria-label': 'Страницы' });
  const tocPages = h('section', { class: 'bk-panel bk-toc-pages' },
    h('header', { class: 'bk-panel-h' }, h('h3', { class: 'bk-toc-h' }, 'Страницы')),
    tocPagesList);
  const tocFocus = h('section', { class: 'bk-panel bk-toc-focus' });
  const tocMeta = h('section', { class: 'bk-panel bk-toc-meta' });
  const toc = h('nav', { class: 'bk-toc', 'aria-label': 'Страницы и выбор для текстов' }, tocPages, tocFocus, tocMeta);
  const pages = h('div', { class: 'bk-pages bk-fit' });
  const scroller = h('div', { class: 'bk-scroll' }, pages);
  const sideEmpty = () => sidePanel('Подсказки',
    h('p', { class: 'hint bk-toc-hint' }, can
      ? 'Нажмите текст или ячейку на листе — правка прямо там. Слева — что заполнить первым. Здесь — состав, ИИ и Inventor.'
      : 'Паспорт открыт только для чтения.'));
  const slot = h('div', { class: 'bk-side-slot' }, sideEmpty());
  const head = h('div', { class: 'bk-head' });
  const side = h('aside', { class: 'bk-side', 'aria-label': 'Подсказки и ИИ' },
    slot,
    aiCheckBlock(() => ({ pages: [...pages.querySelectorAll('.bk-page')].map(pageText) })),
    ilogicBlock());
  const back = h('div', { class: 'modal-back bk-back' }, h('div', { class: 'modal wide bk', role: 'dialog', 'aria-modal': 'true' },
    head, h('div', { class: 'bk-main' }, toc, scroller, side), h('div', { class: 'bk-foot' }, srcLegend(SRC_LABEL), stat)));
  const setStat = (t, tone) => { stat.textContent = t; stat.dataset.tone = tone || ''; };
  let focusApi = null;
  let choicesApi = null;
  let tocPagesLive = [];

  const markTocCurrent = (idx) => {
    [...tocPagesList.children].forEach((btn, i) => {
      const on = i === idx;
      btn.classList.toggle('is-current', on);
      if (on) btn.setAttribute('aria-current', 'true');
      else btn.removeAttribute('aria-current');
    });
  };

  {
    let ticking = false;
    scroller.addEventListener('scroll', () => {
      if (ticking || !tocPagesLive.length) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        const top = scroller.scrollTop + 24;
        let cur = 0;
        tocPagesLive.forEach((p, i) => { if (p.offsetTop <= top) cur = i; });
        markTocCurrent(cur);
      });
    }, { passive: true });
  }

  async function requestClose() {
    if (S.cur?.dirty() && !(await confirmDlg('Закрыть без сохранения?', 'В открытом поле есть несохранённая правка. Она пропадёт.', { okText: 'Закрыть без сохранения', danger: true }))) return;
    document.removeEventListener('keydown', onKey, true);
    back.remove();
    onClose?.(S.r, S.changed);
  }
  // Esc только отменяет правку на листе; книжку закрывает только крестик (владелец 18.11)
  const onKey = (e) => {
    if (e.key !== 'Escape' || document.querySelector('.modal-back:not(.bk-back)')) return;
    e.stopImmediatePropagation(); e.preventDefault();
    if (S.cur) S.cur.cancel();
  };

  // ─── правка: одно поле за раз ───────────────────────────────────────────────
  let edits = []; // открывалки по порядку на странице — для Tab
  const patchPassport = (body) => api('/passports/' + pid(), { method: 'PATCH', body });
  const ctx = { S, can, canNumber, firms: null, patchPassport, exclusive: lock, rerender: () => render(), editable, imageStrip: (...a) => imageStrip(ctx, ...a), compTree: null, compFor: '' };
  let compSeq = 0;
  /** Черновик: дерево состава с изделия. Выпущенный снимок не перечитываем. */
  function ensureComposition() {
    const id = statusOf(S.r) === 'draft' ? String(S.r.productId || '') : '';
    if (!id) { ctx.compTree = null; ctx.compFor = ''; return; }
    if (ctx.compFor === id && ctx.compTree) return;
    const seq = ++compSeq;
    ctx.compFor = id;
    ctx.compTree = { loading: true, lines: [] };
    loadCompositionTree(id).then((lines) => {
      if (seq !== compSeq) return;
      ctx.compTree = { loading: false, lines };
      render();
    }).catch(() => {
      if (seq !== compSeq) return;
      ctx.compTree = { loading: false, failed: true, lines: [] };
      render();
    });
  }

  function editable(view, spec) {
    if (!can || spec.readonly) return view;
    const idx = edits.length;
    view.classList.add('bk-edit');
    view.tabIndex = 0;
    view.setAttribute('role', 'button');
    view.title = 'Нажмите, чтобы править' + (view.title ? ' · ' + view.title : '');
    view.addEventListener('click', (e) => { if (!e.target.closest('a')) openEditor(idx); });
    view.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target === view) { e.preventDefault(); openEditor(idx); } });
    edits.push({ view, spec });
    return view;
  }

  /** Состав в слоте: спросить, если строки менялись; иначе очистить молча. */
  function releaseSlot(then) {
    const ask = slot._bkLeave;
    if (typeof ask !== 'function') { then(); return; }
    void ask().then((ok) => {
      if (!ok) return;
      slot._bkLeave = null;
      slot.closest?.('.bk-side')?.classList.remove('is-wide');
      then();
    });
  }

  /** initial — текст, который надо вернуть в поле после перерисовки (несохранённая правка не теряется). */
  function openEditor(idx, initial) {
    releaseSlot(() => openEditorNow(idx, initial));
  }
  function openEditorNow(idx, initial) {
    if (S.cur) { if (S.cur.dirty()) { toast('Сначала сохраните или отмените правку в открытом поле'); S.cur.focus(); return; } S.cur.cancel(); }
    const { view, spec } = edits[idx];
    const isTa = !spec.options;
    const ctl = isTa
      ? buildForm([{ key: 'text', label: spec.label, type: 'textarea', rows: spec.rows || 2, wide: true, max: 50000 }], { text: initial ?? spec.text }).el.querySelector('textarea')
      : select({ label: spec.label, value: spec.text, options: spec.options });
    if (isTa) ctl.classList.add('bk-ta');
    const fit = () => { if (isTa) ctl.rows = Math.min(30, Math.max(spec.rows || 2, ctl.value.split('\n').length + (ctl.value.length > 60 ? 1 : 0))); };
    const st = h('span', { class: 'bk-st' });
    const dirty = () => ctl.value !== spec.text;
    let working = false;
    const srcState = {};
    const saveLocal = async (next) => {
      if (working) return;
      if (!dirty()) { S.cur = null; if (next && edits[idx + next]) { render(idx + next); return; } render(); return; }
      busy(true); st.textContent = 'Сохраняю…'; setStat('Сохраняю…', 'busy');
      try { await lock(() => spec.save(ctl.value)); }
      catch (e) { busy(false); st.textContent = 'Не сохранено'; setStat('Не сохранено', 'err'); toastError(e); return; }
      S.cur = null;
      setStat('Сохранено в ' + hhmm(), 'ok');
      try { S.r = await api('/passports/' + pid()); } catch { toast('Текст сохранён. Откройте паспорт заново, чтобы увидеть обновление.', { error: true }); }
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
    const local = button({ label: 'Только в этом паспорте', kind: 'primary', size: 'S', title: 'Enter или Ctrl+Enter', onClick: () => saveLocal() });
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
      try { S.r = await api('/passports/' + pid()); } catch { toast('Строка удалена. Откройте паспорт заново, чтобы увидеть обновление.', { error: true }); }
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
    S.cur = { idx, dirty, value: () => ctl.value, cancel: () => { if (!working) { S.cur = null; render(); } }, focus: () => ctl.focus() };
    ctl.focus();
    view.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  // ─── отрисовка и разбивка на страницы ───────────────────────────────────────
  function render(openNext) {
    releaseSlot(() => renderNow(openNext));
  }
  function renderNow(openNext) {
    // внешняя перерисовка (картинки) не теряет несохранённый текст: поле откроется заново с тем же текстом
    const keepEd = typeof openNext !== 'number' && S.cur?.dirty() ? { idx: S.cur.idx, value: S.cur.value() } : null;
    S.cur = null; edits = []; slot.replaceChildren(sideEmpty());
    const keep = scroller.scrollTop;
    ensureComposition();
    const defs = buildBook(ctx);
    pages.replaceChildren();
    const mk = (title) => {
      const body = h('div', { class: 'bk-body' });
      const page = h('section', { class: 'bk-page', 'aria-label': title || 'Страница' }, body);
      pages.append(page);
      return { page, body };
    };
    const room = (p) => p.clientWidth * (210 / 148 - 0.18); // высота тела листа: ширина × 210/148 минус поля (7cqw сверху, 11cqw снизу)
    const over = (c) => c.body.getBoundingClientRect().height > room(c.page) + 1;
    for (const d of defs) {
      if (d.blocks) { for (const b of d.blocks) mk(b.dataset.title).body.append(b); continue; }
      let cur = mk();
      for (const b of d.flow) {
        cur.body.append(b);
        if (!over(cur) || cur.body.children.length < 2) continue;
        const prev = cur.body.children[cur.body.children.length - 2];
        const move = prev?.classList.contains('bk-h') && cur.body.children.length > 2 ? [prev, b] : [b];
        cur = mk(); cur.body.append(...move);
      }
    }
    const org = S.r.supplierOrg;
    [...pages.children].forEach((p, i) => { p.append(h('div', { class: 'bk-pno' }, `${org?.shortName || org?.name || ''} · ${heading(S.r)} · стр. ${i + 1}/${pages.children.length}`)); });
    tocPagesLive = [...pages.children];
    tocPagesList.replaceChildren(...tocPagesLive.map((p, i) => {
      const title = p.querySelector('.bk-h')?.textContent?.split('\n')[0] || p.querySelector('[data-title]')?.dataset.title || p.getAttribute('aria-label') || ('стр. ' + (i + 1));
      // C141: страницы с правками изделия/ручными — заметнее; «общие» — спокойнее
      const hot = !!p.querySelector('.k-src[data-src="product"], .k-src[data-src="manual"], .bk-edit');
      return button({
        type: 'button',
        kind: 'ghost',
        size: 'S',
        cls: 'bk-toc-i' + (hot ? ' is-hot' : ' is-calm'),
        title,
        onClick: () => {
          markTocCurrent(i);
          p.scrollIntoView({ behavior: 'smooth', block: 'start' });
        },
        label: [
          h('span', { class: 'bk-toc-n', 'aria-hidden': 'true' }, String(i + 1)),
          h('span', { class: 'bk-toc-t' }, title),
        ],
      });
    }));
    markTocCurrent(0);
    scroller.scrollTop = keep;
    paintHead();
    focusApi?.refresh();
    if (typeof openNext === 'number' && edits[openNext]) openEditor(openNext);
    else if (keepEd && edits[keepEd.idx]) openEditor(keepEd.idx, keepEd.value);
  }

  function paintHead() {
    const r = S.r;
    const issued = statusOf(r) === 'issued';
    const zoom = (fit) => { S.fit = fit; pages.classList.toggle('bk-fit', fit); pages.classList.toggle('bk-100', !fit); paintHead(); };
    const guard = () => { if (S.cur?.dirty()) { toast('Сначала сохраните или отмените правку в открытом поле'); S.cur.focus(); return true; } return false; };
    const primary = !can ? null : issued
      ? button({ label: 'Сохранить и выпустить заново', kind: 'primary', size: 'S', disabled: !S.changed, title: S.changed ? 'Номер тот же; PDF соберётся из текущих данных' : 'Сначала измените любое поле — тогда кнопка станет активной', onClick: async () => {
        if (guard()) return;
        try { S.r = await api('/passports/' + pid()); } catch (e) { toastError(e); return; }
        toast('Паспорт № ' + numberOf(S.r) + ' обновлён. Номер тот же.');
        await printDialog(S.r);
      } })
      : button({ label: 'Выпустить', kind: 'primary', size: 'S', onClick: async () => {
        if (guard()) return;
        if (!(await confirmDlg('Выпустить паспорт?', 'Паспорт получит номер и гарантийный талон. Правки потом остаются доступны.', { okText: 'Выпустить' }))) return;
        try { const x = await lock(() => api(`/passports/${pid()}/issue`, { method: 'POST' })); toast('Выпущен паспорт № ' + x.passportNumber); S.changed = true; S.r = await api('/passports/' + pid()); render(); } catch (e) { toastError(e); }
      } });
    head.replaceChildren(
      h('h2', null, heading(r), r.name ? ' · ' + r.name : '', ' ', badge(issued ? 'выпущен' : statusOf(r) === 'annulled' ? 'аннулирован' : 'черновик', issued ? 'ok' : 'warn')),
      h('div', { class: 'bk-acts' },
        r.printSource === 'file' || r.printFile?.hasFile ? h('span', { class: 'bk-mark' }, 'К номеру прикреплён свой PDF — печать отдаёт его. ') : null,
        button({ label: 'По ширине', size: 'S', kind: S.fit ? 'primary' : 'ghost', onClick: () => zoom(true) }),
        button({ label: '100 %', size: 'S', kind: S.fit ? 'ghost' : 'primary', onClick: () => zoom(false) }),
        button({ label: 'Скачать PDF', size: 'S', onClick: () => printDialog(S.r) }),
        primary,
        iconButton({ icon: '✕', label: 'Закрыть книжку', title: 'Закрыть книжку — только этой кнопкой', cls: 'k-close', onClick: requestClose })));
  }

  document.addEventListener('keydown', onKey, true);
  document.body.append(back);
  try { ctx.firms = (await ourCompanies()).map((o) => [o.id, o.name]); } catch { ctx.firms = null; }
  render();
  const onLeftChanged = () => { focusApi?.refresh(); render(); };
  choicesApi = mountBookChoices(tocMeta, { S, can, pid, lock, patchPassport, onChanged: onLeftChanged });
  focusApi = mountBookFocus(tocFocus, {
    S, can, pagesEl: pages,
    sideSlot: slot,
    sideHome: () => { releaseSlot(() => slot.replaceChildren(sideEmpty())); },
    onChanged: () => { ctx.compFor = ''; ctx.compTree = null; choicesApi?.refresh(); render(); },
  });
  // клик по фону и Esc книжку не закрывают — только крестик
}
