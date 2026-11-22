import { api, apiBlob, session } from '../../core/api.js';
import { h } from '../../core/dom.js';
import { parseNum } from '../../core/format.js';
import { button, confirmDlg, draggable, segmented } from '../../ui/kit/index.js';
import { toastError } from '../../ui/kit/toast.js';
import { isAdmin, withReason } from '../admin-override.js';
import { loadOfferParties, partyOptions } from '../offer-memory.js';
import { offerWriteItems } from '../offer-source.js';
import { offerPaper } from './editor-paper.js';
import { offerGeometry, offerSurface } from './editor-surface.js';
import { blocks, editorControls, group, rowTotal } from './editor-controls.js';

const fields = ['date', 'customer', 'counterpartyId', 'objectName', 'notes', 'terms', 'validUntil', 'prepaymentPercent',
  'productionDays', 'deliveryDays', 'vatMode', 'vatRate', 'delivery', 'bg1Id', 'bg2Id'];
function editable(record) {
  const draft = Object.fromEntries(fields.map((key) => [key, record[key] ?? null]));
  if (draft.date) draft.date = String(draft.date).slice(0, 10);
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
  let pageMap, geometry, page = 1, zoomMode = 'width';
  const surfaces = new Map();
  const previousFocus = document.activeElement;
  const status = h('span', { class: 'bk-stat', role: 'status' });
  let printReady = false;
  let frame = h('iframe', { title: 'PDF для печати', hidden: true });
  const surface = offerSurface({
    select: (area) => selectView(areaView(area), false),
    field: inlineField, drag: dragOnSheet, remove: removeOnSheet, editState: enable,
    busy: () => busy || shown !== seq,
  });
  const paper = offerPaper((e) => { status.textContent = 'Не удалось показать лист: ' + e.message; }, mountSurface);
  const nav = h('nav', { class: 'bk-toc', 'aria-label': 'Содержание КП' });
  const side = h('aside', { class: 'bk-side', 'aria-label': 'Свойства документа' });
  const btn = (label, onClick, primary = false) => button({ label, size: 'S', kind: primary ? 'primary' : 'secondary', onClick });
  const pageLabel = h('span', { class: 'num', 'aria-live': 'polite' });
  const previous = btn('Назад', () => showPage(page - 1));
  const next = btn('Далее', () => showPage(page + 1));
  const zoom = segmented({ label: 'Масштаб листа', fit: true, value: 'width',
    items: [{ key: 'fit', label: 'Лист целиком' }, { key: 'width', label: 'По ширине' }, { key: 'large', label: 'Увеличить' }],
    onChange: (mode) => { zoomMode = mode; showPage(page); } });
  const saveButton = btn('Сохранить', save, true);
  const printButton = btn('Печать', print);
  const downloadButton = btn('Скачать PDF', download);
  const closeButton = btn('Закрыть', close);
  const addPosition = btn('Добавить позицию', insertPosition);
  const addText = btn('Добавить текст', insertText);
  const root = h('div', { class: 'modal-back bk-back offer-editor' },
    h('link', { rel: 'stylesheet', href: new URL('../../ui/kit/offer-editor.css', import.meta.url).href }),
    h('div', { class: 'modal wide bk', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Редактор КП' },
      h('header', { class: 'bk-head' }, h('h2', null, saved.number), h('b', { class: 'bk-sku' }, saved.companyName),
        h('div', { class: 'bk-acts' }, saveButton, printButton, downloadButton, closeButton)),
      h('div', { class: 'offer-toolbar' }, addPosition, addText,
        h('span', { class: 'muted' }, 'Двойной щелчок по дате, тексту или ячейке. Выберите фото или таблицу и потяните за маркер.')),
      h('div', { class: 'bk-main' }, nav, paper.stage, side, frame),
      h('footer', { class: 'bk-foot' }, h('div', { class: 'bk-ed-row' }, previous, pageLabel, next, zoom.el), status)));

  function edits() {
    return Object.fromEntries(Object.entries(draft).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(initial[key])));
  }
  const body = (changes) => ({ ...changes, expectedUpdatedAt: saved.updatedAt ?? null, ...(saved.legal ? { version: saved.legalVersion } : {}) });
  function validity() {
    if (!draft.date) return 'Укажите дату КП';
    if (!draft.customer?.trim()) return 'Укажите заказчика';
    if (!draft.items.length) return 'Добавьте хотя бы одну позицию';
    const width = draft.layout.tableWidthMm;
    if (width != null && (!Number.isInteger(width) || width < 160 || width > 181)) return 'Укажите ширину таблицы от 160 до 181 мм';
    const bad = draft.items.findIndex((r) => !r.productName?.trim() || !(r.quantity >= 0.001) || (r.unitPrice != null && !(r.unitPrice >= 0)));
    if (bad >= 0) return 'Проверьте название, количество и цену строки ' + (bad + 1);
    return '';
  }
  function enable() {
    const ready = shown === seq && !!url && !busy && !surface.editing;
    previous.disabled = !ready || page <= 1; next.disabled = !ready || page >= (pageMap?.count || 1);
    addPosition.disabled = busy || surface.editing || draft.items.length >= 300;
    addText.disabled = !ready || !geometry || (draft.layout.texts?.length || 0) >= 12;
    closeButton.disabled = busy || surface.editing;
    downloadButton.disabled = !ready;
    printButton.disabled = !ready || !printReady;
    saveButton.disabled = !ready || !Object.keys(edits()).length;
  }
  function showPage(number) {
    if (!url) return;
    page = Math.max(1, Math.min(number || 1, pageMap?.count || 1));
    void paper.draw(page, zoomMode);
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
  function insertPosition() {
    if (shown !== seq || !geometry) return addRow();
    surface.insert({
      type: 'text', label: 'Название новой позиции', placeholder: 'Название изделия', max: 300,
      validate: (value) => !!value.trim(), write: (value) => addRow(value.trim()),
      alternative: { label: 'Из каталога', run: () => addRow() },
    }, 'table');
  }
  function addRow(productName = '') {
    if (draft.items.length >= 300) return;
    const row = { productName, quantity: 1, unit: 'шт', lineKind: 'product' };
    newRows.add(row);
    const at = typeof view === 'number' ? view + 1 : draft.items.length;
    draft.items.splice(at, 0, row);
    changed(); selectView(at);
    if (!productName) side.querySelector('.bk-side input[placeholder*="артикул"], input[aria-label="Наименование"]')?.focus();
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
    nav.replaceChildren(group('Содержание', navButton('document', 'Дата, заказчик и бланк'), ...draft.layout.blocks.map((k) => navButton(k, blocks[k] || textByKey(k)?.text || 'Текст'))),
      group('Позиции',
        ...draft.items.map((r, n) => navButton(n, (n + 1) + '. ' + (r.productName || 'Новая позиция'), rowTotal(r)))));
  }
  function selectView(key, follow = true) {
    if (surface.editing) return;
    view = key; paintNav(); if (follow && selectedPage()) showPage(selectedPage());
    side.replaceChildren(editorControls({ draft, saved, view, parties, backgrounds: backgrounds.items || [],
      changed, paintNav, selectView, removeRow, newRows, removeText }));
  }

  const textByKey = (key) => draft.layout.texts?.find((entry) => 'text:' + entry.id === key);
  const areaView = (area) => Number.isInteger(area.row) ? area.row
    : draft.layout.blocks.includes(area.key) ? area.key : 'document';
  function inlineField({ key, row }) {
    const text = textByKey(key);
    const target = text || (Number.isInteger(row) ? draft.items[row] : draft);
    if (!target) return null;
    const source = target.sourceLine || target.sourceRowKey;
    const prop = text ? 'text' : key;
    const max = { customer: 300, objectName: 500, productName: 300, description: 1000, unit: 20, terms: 3000, notes: 2000, text: 2000 };
    const numeric = key === 'quantity' || key === 'unitPrice';
    if ((key === 'date' && saved.legal) || (source && ['quantity', 'unitPrice', 'productName', 'unit'].includes(key))) return null;
    if (!(prop in max) && key !== 'date' && !numeric) return null;
    const type = numeric ? 'number' : ['terms', 'notes', 'description', 'text'].includes(prop) ? 'area' : key === 'date' ? 'date' : 'text';
    return {
      value: target[prop], type, max: max[prop],
      validate: (raw) => numeric ? (key === 'unitPrice' && !raw.trim()) || parseNum(raw) >= (key === 'quantity' ? 0.001 : 0)
        : !['date', 'customer', 'productName', 'unit', 'text'].includes(prop) || !!raw.trim(),
      write: (raw) => {
        const value = numeric ? (raw.trim() ? parseNum(raw) : null) : raw.trim();
        if (target[prop] === value) return;
        target[prop] = value;
        if (key === 'customer') draft.counterpartyId = null;
        changed(); selectView(areaView({ key, row }), false);
      },
    };
  }
  function insertText() {
    const anchor = surface.selection?.key;
    surface.insert({
      type: 'area', label: 'Новый текст', placeholder: 'Введи текст', max: 2000,
      validate: (value) => !!value.trim(),
      write: (value) => {
        const id = crypto.randomUUID();
        const key = 'text:' + id;
        (draft.layout.texts ||= []).push({ id, text: value.trim() });
        const at = draft.layout.blocks.indexOf(anchor);
        draft.layout.blocks.splice(at < 0 ? draft.layout.blocks.indexOf('table') : at + 1, 0, key);
        changed(); selectView(key);
      },
    }, 'table');
  }
  async function removeText(key) {
    const text = textByKey(key);
    if (!text || !await confirmDlg('Удалить текст?', text.text.slice(0, 150), { okText: 'Удалить', danger: true })) return;
    draft.layout.texts = draft.layout.texts.filter((entry) => entry !== text);
    if (!draft.layout.texts.length) delete draft.layout.texts;
    draft.layout.blocks = draft.layout.blocks.filter((entry) => entry !== key);
    changed(); selectView('document', false);
  }
  function removeOnSheet(area) {
    if (Number.isInteger(area.row) && draft.items[area.row]) return removeRow(draft.items[area.row]);
    if (textByKey(area.key)) return removeText(area.key);
  }
  function dragOnSheet({ area, mode, dx, dy, target, below }) {
    const { key, row } = area;
    const mm = (pt) => pt * 25.4 / 72;
    const clamp = (v, min, max) => Math.max(min, Math.min(max, Math.round(v)));
    let next = areaView(area);
    if (mode === 'resize') {
      if (key === 'table') draft.layout.tableWidthMm = clamp(mm(area.w + dx), 160, 181);
      if (key === 'photo') {
        const delta = Math.abs(dx) > Math.abs(dy) ? dx : dy;
        draft.items[row].photoMm = clamp(mm(Math.max(area.w, area.h) + delta), 8, 42);
      }
      if (key === 'row') draft.items[row].rowMm = clamp(mm(area.h + dy), 7, 65);
    } else if (key === 'row') {
      if (target?.row == null) return;
      const [item] = draft.items.splice(row, 1);
      next = target.row + (below ? 1 : 0) - (target.row > row ? 1 : 0);
      draft.items.splice(next, 0, item);
    } else if (target) {
      const order = draft.layout.blocks;
      order.splice(order.indexOf(key), 1);
      order.splice(order.indexOf(target.key) + (below ? 1 : 0), 0, key);
    } else {
      const target = textByKey(key) || (draft.layout[key] ||= {});
      target.xMm = clamp((target.xMm || 0) + mm(dx), -10, 10);
      target.gapMm = clamp((target.gapMm || 0) + mm(dy), 0, 40);
    }
    changed(); selectView(next);
  }
  function mountSurface(layer, props) {
    const active = geometry;
    const data = active?.pages?.[props.page - 1] || surfaces.get(props.page)?.regions;
    surface.mount(layer, props, data);
    if (!active?.paged || surfaces.has(props.page)) return;
    const entry = {};
    const fetch = active.load({ geometryPage: props.page });
    surfaces.set(props.page, entry);
    fetch.then(async (file) => {
      const detail = await offerGeometry(file.headers);
      if (geometry !== active) return;
      if (detail?.page !== props.page || detail.revision !== active.revision) {
        status.textContent = 'Макет изменился. Открой КП заново для правки этого листа.';
        return;
      }
      entry.regions = detail.pages[0];
      if (props.page === page) paper.updateSurface();
    }).catch(() => {
      if (geometry === active) {
        surfaces.delete(props.page);
        status.textContent = 'Инструменты этого листа недоступны. Повтори переход к листу.';
      }
    });
  }

  async function preview(stamp) {
    const changes = edits();
    try {
      const dirty = Object.keys(changes).length > 0;
      const payload = dirty ? body(changes) : undefined;
      const load = (query) => apiBlob(path + (dirty ? '/preview' : '/pdf'), { query, ...(dirty ? { method: 'POST', body: payload } : {}) });
      const file = await load();
      if (stamp !== seq || !root.isConnected) return;
      await paper.load(file.blob);
      const shape = await offerGeometry(file.headers).catch(() => null);
      if (stamp !== seq || !root.isConnected) return;
      geometry = shape && { ...shape, load };
      surfaces.clear();
      const old = url;
      url = URL.createObjectURL(new Blob([file.blob], { type: 'application/pdf' }));
      name = file.name || saved.number + '.pdf';
      try { pageMap = JSON.parse(file.headers.get('x-offer-pages')); } catch { pageMap = null; }
      printReady = false;
      const printable = h('iframe', { title: 'PDF для печати', hidden: true, src: url,
        onload: () => { if (frame === printable && root.isConnected) { printReady = true; enable(); } } });
      frame.replaceWith(printable); frame = printable;
      shown = stamp;
      showPage(selectedPage() || page);
      if (old) URL.revokeObjectURL(old);
      enable();
      status.textContent = Object.keys(changes).length ? 'Есть несохранённые изменения' : 'Сохранённая версия';
    } catch (e) {
      if (stamp !== seq || !root.isConnected) return;
      status.textContent = e.message || 'Не удалось получить PDF'; enable();
    }
  }
  function changed() {
    clearTimeout(timer);
    const stamp = ++seq;
    paintNav(); enable(); surface.refresh();
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
    if (busy || surface.editing || (Object.keys(edits()).length && !await confirmDlg('Закрыть без сохранения?', 'Изменения КП будут потеряны.', { okText: 'Закрыть без сохранения', danger: true }))) return;
    clearTimeout(timer); paper.close(); seq++;
    document.removeEventListener('keydown', keydown, true);
    root.remove(); if (url) URL.revokeObjectURL(url);
    if (savedOnce) await onSaved?.();
    if (previousFocus?.isConnected) previousFocus.focus();
  }
  function keydown(e) {
    if (document.querySelector('.modal-back:last-of-type') !== root) return;
    if (e.key === 'Escape' && !surface.editing && !root.querySelector('[aria-expanded="true"]')) {
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
