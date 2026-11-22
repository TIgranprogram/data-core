import { api, apiBlob, session } from '../../core/api.js';
import { h } from '../../core/dom.js';
import { button, confirmDlg, draggable, segmented } from '../../ui/kit/index.js';
import { toastError } from '../../ui/kit/toast.js';
import { isAdmin, withReason } from '../admin-override.js';
import { loadOfferParties, partyOptions } from '../offer-memory.js';
import { offerWriteItems } from '../offer-source.js';
import { offerPaper } from './editor-paper.js';
import { blocks, editorControls, group, rowTotal } from './editor-controls.js';

const fields = ['customer', 'counterpartyId', 'objectName', 'notes', 'terms', 'validUntil', 'prepaymentPercent',
  'productionDays', 'deliveryDays', 'vatMode', 'vatRate', 'delivery', 'bg1Id', 'bg2Id'];
function editable(record) {
  const draft = Object.fromEntries(fields.map((key) => [key, record[key] ?? null]));
  if (draft.validUntil) draft.validUntil = String(draft.validUntil).slice(0, 10);
  draft.items = offerWriteItems(record.items);
  draft.layout = { ...structuredClone(record.layout || {}), blocks: [...(record.layout?.blocks || Object.keys(blocks))] };
  return draft;
}

export const canOpenOfferEditor = (row) => session.canMoney && session.canEditOrders && (row.status !== 'paid' || (isAdmin() && !row.orderId));
export const offerEditorButton = (row, ctx) => canOpenOfferEditor(row)
  ? button({ label: 'Открыть в редакторе', kind: 'primary', onClick: () => openOfferEditor(row.id, ctx.reload) }) : null;

export async function openOfferEditor(id, onSaved) {
  if (document.querySelector('.offer-editor')) return;
  const path = '/offers/' + id;
  let saved, backgrounds, customers;
  try {
    [saved, backgrounds, customers] = await Promise.all([api(path), api('/offers/backgrounds'), loadOfferParties()]);
  } catch (e) { toastError(e); return; }
  if (document.querySelector('.offer-editor')) return;
  const parties = partyOptions(customers.parties, customers.recent);
  let initial = editable(saved), draft = structuredClone(initial), view = 'document';
  const newRows = new WeakSet();
  let seq = 0, shown = -1, timer, url = '', name = '', busy = false, savedOnce = false;
  let pageMap, page = 1, enlarged = false;
  const previousFocus = document.activeElement;
  const status = h('span', { class: 'bk-stat', role: 'status' });
  let printReady = false;
  let frame = h('iframe', { title: 'PDF для печати', hidden: true });
  const paper = offerPaper((e) => { status.textContent = 'Не удалось показать лист: ' + e.message; });
  const nav = h('nav', { class: 'bk-toc', 'aria-label': 'Содержание КП' });
  const side = h('aside', { class: 'bk-side', 'aria-label': 'Свойства документа' });
  const btn = (label, onClick, primary = false) => button({ label, size: 'S', kind: primary ? 'primary' : 'secondary', onClick });
  const pageLabel = h('span', { class: 'num', 'aria-live': 'polite' });
  const previous = btn('Назад', () => showPage(page - 1));
  const next = btn('Далее', () => showPage(page + 1));
  const zoom = segmented({ label: 'Масштаб листа', fit: true, value: 'fit',
    items: [{ key: 'fit', label: 'Уместить' }, { key: 'large', label: 'Увеличить' }],
    onChange: (mode) => { enlarged = mode === 'large'; showPage(page); } });
  const saveButton = btn('Сохранить', save, true);
  const printButton = btn('Печать', print);
  const downloadButton = btn('Скачать PDF', download);
  const closeButton = btn('Закрыть', close);
  const root = h('div', { class: 'modal-back bk-back offer-editor' },
    h('link', { rel: 'stylesheet', href: new URL('../../ui/kit/offer-editor.css', import.meta.url).href }),
    h('div', { class: 'modal wide bk', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Редактор КП' },
      h('header', { class: 'bk-head' }, h('h2', null, saved.number), h('b', { class: 'bk-sku' }, saved.companyName),
        h('div', { class: 'bk-acts' }, saveButton, printButton, downloadButton, closeButton)),
      h('div', { class: 'bk-main' }, nav, paper.stage, side, frame),
      h('footer', { class: 'bk-foot' }, h('div', { class: 'bk-ed-row' }, previous, pageLabel, next, zoom.el), status)));

  function edits() {
    return Object.fromEntries(Object.entries(draft).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(initial[key])));
  }
  const body = (changes) => ({ ...changes, expectedUpdatedAt: saved.updatedAt ?? null, ...(saved.legal ? { version: saved.legalVersion } : {}) });
  function validity() {
    if (!draft.customer?.trim()) return 'Укажите заказчика';
    if (!draft.items.length) return 'Добавьте хотя бы одну позицию';
    const width = draft.layout.tableWidthMm;
    if (width != null && (!Number.isInteger(width) || width < 160 || width > 181)) return 'Укажите ширину таблицы от 160 до 181 мм';
    const bad = draft.items.findIndex((r) => !r.productName?.trim() || !(r.quantity >= 0.001) || (r.unitPrice != null && !(r.unitPrice >= 0)));
    if (bad >= 0) return 'Проверьте название, количество и цену строки ' + (bad + 1);
    return '';
  }
  function enable() {
    const ready = shown === seq && !!url && !busy;
    previous.disabled = !ready || page <= 1; next.disabled = !ready || page >= (pageMap?.count || 1);
    downloadButton.disabled = !ready;
    printButton.disabled = !ready || !printReady;
    saveButton.disabled = !ready || !Object.keys(edits()).length;
  }
  function showPage(number) {
    if (!url) return;
    page = Math.max(1, Math.min(number || 1, pageMap?.count || 1));
    void paper.draw(page, enlarged);
    pageLabel.textContent = 'Лист ' + page + ' из ' + (pageMap?.count || 1);
    enable();
  }
  function selectedPage() {
    return typeof view === 'number' ? pageMap?.rows[view] : pageMap?.blocks[view];
  }
  function navButton(key, title, sub = '') {
    const item = button({ label: title, cls: 'bk-toc-i', kind: 'ghost', size: 'S', onClick: () => selectView(key) });
    item.title = title;
    item.setAttribute('aria-label', sub ? title + ', ' + sub : title);
    item.setAttribute('aria-current', String(view === key));
    item.replaceChildren(h('span', { class: 'bk-toc-t', title }, title), sub ? h('small', { class: 'muted' }, sub) : null);
    if (key === 'document') return item;
    const isRow = typeof key === 'number', kind = isRow ? 'rows' : 'blocks';
    const grip = h('span', { class: 'offer-grip', title: 'Перетащить для изменения порядка', 'aria-hidden': 'true' }, '⠿');
    const entry = h('div', { class: 'offer-sort', dataset: { sortKind: kind, sortKey: key } }, grip, item);
    draggable(entry, { scroller: nav, targetSel: '[data-sort-kind="' + kind + '"]',
      canDrop: (el) => nav.contains(el) && el !== entry,
      onDrop: (el) => {
        const list = isRow ? draft.items : draft.layout.blocks;
        const from = isRow ? key : list.indexOf(key);
        const to = isRow ? Number(el.dataset.sortKey) : list.indexOf(el.dataset.sortKey);
        list.splice(to, 0, list.splice(from, 1)[0]);
        changed(); selectView(isRow ? to : key);
      } });
    return entry;
  }
  function addRow() {
    if (draft.items.length >= 300) return;
    const row = { productName: '', quantity: 1, unit: 'шт', lineKind: 'product' };
    newRows.add(row);
    draft.items.push(row);
    changed(); selectView(draft.items.length - 1);
    side.querySelector('[aria-label="Наименование"]')?.focus();
  }
  async function removeRow(row) {
    if (row.sourceLine || row.sourceRowKey) return;
    const confirmed = await confirmDlg('Удалить позицию?', row.productName || 'Новая позиция', { okText: 'Удалить', danger: true });
    const index = draft.items.indexOf(row);
    if (!confirmed || index < 0) return;
    draft.items.splice(index, 1);
    changed(); selectView(draft.items.length ? Math.min(index, draft.items.length - 1) : 'table');
  }
  function paintNav() {
    nav.replaceChildren(group('Содержание', navButton('document', 'Заказчик и бланк'), ...draft.layout.blocks.map((k) => navButton(k, blocks[k]))),
      group('Позиции', button({ label: 'Добавить позицию', size: 'S', disabled: draft.items.length >= 300, onClick: addRow }),
        ...draft.items.map((r, n) => navButton(n, (n + 1) + '. ' + (r.productName || 'Новая позиция'), rowTotal(r)))));
  }
  function selectView(key) {
    view = key; paintNav(); if (selectedPage()) showPage(selectedPage());
    side.replaceChildren(editorControls({ draft, saved, view, parties, backgrounds: backgrounds.items || [],
      changed, paintNav, selectView, removeRow, newRows }));
  }
  async function preview(stamp) {
    const changes = edits();
    try {
      const file = await apiBlob(path + (Object.keys(changes).length ? '/preview' : '/pdf'),
        Object.keys(changes).length ? { method: 'POST', body: body(changes) } : {});
      if (stamp !== seq || !root.isConnected) return;
      await paper.load(file.blob);
      if (stamp !== seq || !root.isConnected) return;
      const old = url;
      url = URL.createObjectURL(new Blob([file.blob], { type: 'application/pdf' }));
      name = file.name || saved.number + '.pdf';
      try { pageMap = JSON.parse(file.headers.get('x-offer-pages')); } catch { pageMap = null; }
      printReady = false;
      const printable = h('iframe', { title: 'PDF для печати', hidden: true, src: url,
        onload: () => { if (frame === printable && root.isConnected) { printReady = true; enable(); } } });
      frame.replaceWith(printable); frame = printable;
      showPage(selectedPage() || page);
      if (old) URL.revokeObjectURL(old);
      shown = stamp; enable();
      status.textContent = Object.keys(changes).length ? 'Есть несохранённые изменения' : 'Сохранённая версия';
    } catch (e) {
      if (stamp !== seq || !root.isConnected) return;
      status.textContent = e.message || 'Не удалось получить PDF'; enable();
    }
  }
  function changed() {
    clearTimeout(timer);
    const stamp = ++seq;
    paintNav(); enable();
    const error = validity();
    status.textContent = error || 'Готовим печатные страницы…';
    if (!error) timer = setTimeout(() => preview(stamp), 450);
  }
  async function save() {
    if (busy || shown !== seq) return;
    busy = true; side.inert = nav.inert = true; enable();
    try {
      const payload = body(edits());
      const updated = await withReason((reason) => api(path, { method: 'PATCH', body: { ...payload, ...(reason ? { reason } : {}) } }), 'Править оплаченное КП');
      if (!updated) return;
      saved = updated; savedOnce = true; initial = editable(saved); draft = structuredClone(initial);
      selectView(view);
      status.textContent = 'КП сохранено';
      await preview(++seq);
    } catch (e) { status.textContent = e.message; toastError(e); }
    finally {
      busy = false; side.inert = nav.inert = false;
      // Общий обработчик кнопки восстанавливает disabled после асинхронного действия.
      setTimeout(enable, 0);
    }
  }
  function print() {
    if (shown !== seq || !url || !printReady) return;
    try { frame.contentWindow.focus(); frame.contentWindow.print(); }
    catch { window.open(url, '_blank', 'noopener'); }
  }
  function download() {
    if (shown !== seq || !url) return;
    const a = h('a', { href: url, download: name }); root.append(a); a.click(); a.remove();
  }
  async function close() {
    if (busy || (Object.keys(edits()).length && !await confirmDlg('Закрыть без сохранения?', 'Изменения КП будут потеряны.', { okText: 'Закрыть без сохранения', danger: true }))) return;
    clearTimeout(timer); paper.close(); seq++;
    document.removeEventListener('keydown', keydown, true);
    root.remove(); if (url) URL.revokeObjectURL(url);
    if (savedOnce) await onSaved?.();
    if (previousFocus?.isConnected) previousFocus.focus();
  }
  function keydown(e) {
    if (document.querySelector('.modal-back:last-of-type') !== root) return;
    if (e.key === 'Escape' && !root.querySelector('[aria-expanded="true"]')) {
      e.preventDefault(); e.stopImmediatePropagation(); void close();
    }
    if (e.key !== 'Tab') return;
    const focusable = [...root.querySelectorAll('button,input,textarea,select,iframe')].filter((el) => !el.disabled && el.getClientRects().length);
    const end = e.shiftKey ? focusable[0] : focusable.at(-1);
    if (document.activeElement === end) { e.preventDefault(); (e.shiftKey ? focusable.at(-1) : focusable[0])?.focus(); }
  }
  document.body.append(root); selectView(view); enable(); closeButton.focus();
  document.addEventListener('keydown', keydown, true);
  status.textContent = 'Готовим печатные страницы…';
  await preview(seq);
}
