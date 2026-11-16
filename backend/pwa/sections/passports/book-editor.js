/**
 * C134: паспорт «как в PDF» — большое окно со страницами А5; любое поле правится в правой панели.
 * Содержимое страниц — book-blocks.js, картинки — book-images.js, ссылки «табл./рис.» — book-refs.js, ИИ/источник — book-shared.js.
 * Жизненный цикл правки: одно открытое поле; внешняя перерисовка (картинки) сохраняет несохранённый текст; запись — под замком паспорта.
 */
import { api, session } from '../../core/api.js';
import { h } from '../../core/dom.js';
import { toast, toastError } from '../../ui/kit/toast.js';
import { confirmDlg } from '../../ui/kit/dialog.js';
import { button, badge, select } from '../../ui/kit/index.js';
import { buildForm } from '../../ui/kit/form.js';
import { srcLegend } from '../../ui/kit/src.js';
import { canEdit, canWorkPassport, heading, numberOf, ourCompanies, statusOf } from './common.js';
import { passportAction } from './field-edit.js';
import { pickSourceKey, aiCheckBlock, pageText, exclusive } from './book-shared.js';
import { buildBook } from './book-blocks.js';
import { imageStrip } from './book-images.js';
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
  const toc = h('nav', { class: 'bk-toc', 'aria-label': 'Страницы паспорта' });
  const pages = h('div', { class: 'bk-pages bk-fit' });
  const scroller = h('div', { class: 'bk-scroll' }, pages);
  const sideEmpty = () => h('p', { class: 'hint' }, can ? 'Нажмите на текст в паспорте — он откроется здесь для правки.' : 'Паспорт открыт только для чтения.');
  const slot = h('div', null, sideEmpty());
  const head = h('div', { class: 'bk-head' });
  const side = h('aside', { class: 'bk-side', 'aria-label': 'Правка' }, slot, aiCheckBlock(() => ({ pages: [...pages.querySelectorAll('.bk-page')].map(pageText) })));
  const back = h('div', { class: 'modal-back bk-back' }, h('div', { class: 'modal wide bk', role: 'dialog', 'aria-modal': 'true' },
    head, h('div', { class: 'bk-main' }, toc, scroller, side), h('div', { class: 'bk-foot' }, srcLegend(SRC_LABEL), stat)));
  const setStat = (t, tone) => { stat.textContent = t; stat.dataset.tone = tone || ''; };

  async function requestClose() {
    if (S.cur?.dirty() && !(await confirmDlg('Закрыть без сохранения?', 'В открытом поле есть несохранённая правка. Она пропадёт.', { okText: 'Закрыть без сохранения', danger: true }))) return;
    document.removeEventListener('keydown', onKey, true);
    back.remove();
    onClose?.(S.r, S.changed);
  }
  const onKey = (e) => {
    if (e.key !== 'Escape' || document.querySelector('.modal-back:not(.bk-back)')) return;
    e.stopImmediatePropagation(); e.preventDefault();
    if (S.cur) S.cur.cancel(); else requestClose();
  };

  // ─── правка: одно поле за раз ───────────────────────────────────────────────
  let edits = []; // открывалки по порядку на странице — для Tab
  const patchPassport = (body) => api('/passports/' + pid(), { method: 'PATCH', body });
  const ctx = { S, can, canNumber, firms: null, patchPassport, exclusive: lock, rerender: () => render(), editable, imageStrip: (...a) => imageStrip(ctx, ...a) };

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

  /** initial — текст, который надо вернуть в поле после перерисовки (несохранённая правка не теряется). */
  function openEditor(idx, initial) {
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
    const busy = (on) => { working = on; [local, shared, reset, cancelBtn].forEach((b) => b && (b.disabled = on)); ctl.disabled = on; };
    const srcState = {};
    const clear = () => { S.cur = null; view.classList.remove('is-editing'); slot.replaceChildren(sideEmpty()); };
    const saveLocal = async (next) => {
      if (working) return;
      if (!dirty()) { clear(); if (next && edits[idx + next]) openEditor(idx + next); return; }
      busy(true); st.textContent = 'Сохраняю…'; setStat('Сохраняю…', 'busy');
      try { await lock(() => spec.save(ctl.value)); }
      catch (e) { busy(false); st.textContent = 'Не сохранено'; setStat('Не сохранено', 'err'); toastError(e); return; }
      clear();
      setStat('Сохранено в ' + hhmm(), 'ok');
      try { S.r = await api('/passports/' + pid()); } catch { toast('Текст сохранён. Откройте паспорт заново, чтобы увидеть обновление.', { error: true }); }
      S.changed = true;
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
        busy(false); clear();
      } catch (e) { busy(false); st.textContent = ''; toastError(e); }
    };
    const local = button({ label: 'Только в этом паспорте', kind: 'primary', size: 'S', title: 'Enter или Ctrl+Enter', onClick: () => saveLocal() });
    const shared = spec.shared && canEdit() ? button({ label: 'В справочник', size: 'S', title: 'Для всех изделий этой категории или источника', onClick: saveShared }) : null;
    const reset = spec.original != null && spec.original !== '' ? button({ label: 'Вернуть исходный', kind: 'ghost', size: 'S', title: 'Подставить текст из справочника, как было до правки', onClick: () => { ctl.value = spec.original; fit(); ctl.focus(); } }) : null;
    const cancelBtn = button({ label: 'Отмена', kind: 'ghost', size: 'S', title: 'Esc', onClick: () => { if (!working) clear(); } });
    const box = h('div', { class: 'bk-ed' }, ctl,
      h('div', { class: 'bk-ed-row' }, local, shared, reset, cancelBtn), h('div', { class: 'bk-ed-row' }, st, h('span', { class: 'bk-keys' }, 'Enter — сохранить · Esc — отмена · Tab — дальше')));
    if (isTa) ctl.addEventListener('input', fit);
    ctl.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); if (!working) clear(); }
      else if (e.key === 'Enter' && (isTa ? !e.shiftKey || e.ctrlKey || e.metaKey : true)) { e.preventDefault(); saveLocal(); }
      else if (e.key === 'Tab') { e.preventDefault(); saveLocal(e.shiftKey ? -1 : 1); }
    });
    view.classList.add('is-editing'); slot.replaceChildren(h('h3', { class: 'bk-side-h' }, spec.label || 'Правка'), box);
    fit();
    S.cur = { idx, dirty, value: () => ctl.value, cancel: () => { if (!working) clear(); }, focus: () => ctl.focus() };
    ctl.focus();
    view.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  // ─── отрисовка и разбивка на страницы ───────────────────────────────────────
  function render(openNext) {
    // внешняя перерисовка (картинки) не теряет несохранённый текст: поле откроется заново с тем же текстом
    const keepEd = typeof openNext !== 'number' && S.cur?.dirty() ? { idx: S.cur.idx, value: S.cur.value() } : null;
    S.cur = null; edits = []; slot.replaceChildren(sideEmpty());
    const keep = scroller.scrollTop;
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
    toc.replaceChildren(...[...pages.children].map((p, i) => {
      const title = p.querySelector('.bk-h')?.textContent?.split('\n')[0] || p.querySelector('[data-title]')?.dataset.title || p.getAttribute('aria-label');
      return button({ label: 'стр. ' + (i + 1) + ' · ' + title, title, kind: 'ghost', size: 'S', cls: 'bk-toc-i', onClick: () => p.scrollIntoView({ behavior: 'smooth', block: 'start' }) });
    }));
    scroller.scrollTop = keep;
    paintHead();
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
        button({ label: 'Закрыть', kind: 'ghost', size: 'S', onClick: requestClose })));
  }

  document.addEventListener('keydown', onKey, true);
  document.body.append(back);
  try { ctx.firms = (await ourCompanies()).map((o) => [o.id, o.name]); } catch { ctx.firms = null; }
  render();
  back.addEventListener('mousedown', (e) => { if (e.target === back) requestClose(); });
}
