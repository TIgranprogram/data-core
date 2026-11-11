import { mark } from './mark.js';
import { h } from '../../core/dom.js';
import { button, iconButton, link } from './index.js';

/**
 * treeTable — эталон «дерево в таблице» (вариант `table.cal`, C084): строки до 3 уровней, шеврон, «Ещё N», строка-вставка под строкой.
 *   treeTable({ label, head, periods: [{ label, today? }], totalLabel, shareLabel, rows, open, maxKids = 8, keepKids = 7, moreLabel(rest) })
 *   row: { id, label (текст | узел), cls?, cells: [{ v, click?, title? } | null] (по одной на период), total: { v, click?, title? }, share?: { text, ratio 0..1 }, kids?: row[], raw? }
 *   open — Set раскрытых id (меняется на месте, хранит вызывающий). Глубина уровня считается сама (верхний = 1), `depth` у строки задаёт её явно (статьи под «Расходы» — 2).
 *   Все строки строятся один раз; раскрытие только переключает класс (без запросов и перерисовки), появление — opacity + transform ≤ .2s.
 *   → { el, toggle(id, force?), expandAll(), collapseAll(), insert(id, { title, onClose }) → { body, close }, closeInsert() }
 *   Вставка: одна на таблицу, ячейка на всю ширину под строкой; строка выделена золотой полосой слева; Esc и «Скрыть» закрывают.
 */
export function treeTable({ label, head = 'Статья', periods = [], totalLabel = 'Итого', shareLabel = '%', rows = [], open = new Set(), maxKids = 8, keepKids = 7, moreLabel } = {}) {
  const colSpan = periods.length + 3;
  const recs = new Map();
  const root = { id: '', kids: [], depth: 0, more: null };
  let ins = null; // { rec, tr, key }

  const cellTd = (c, i, cls = 'day') => {
    const can = !!c?.click;
    return h('td', { class: cls + (can ? ' click' : '') + (periods[i]?.today ? ' today' : ''), title: can ? (c.title || 'Операции') : null, tabindex: can ? '0' : null, role: can ? 'button' : null,
      onclick: can ? c.click : null, onkeydown: can ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); c.click(e); } } : null }, c?.v ?? '');
  };

  const mkRec = (n, parent, isRest) => {
    const rec = { n, id: n.id, parent, depth: n.depth ?? parent.depth + 1, kids: [], more: null, isRest, tr: null };
    const has = !!n.kids?.length;
    const flip = () => toggle(n.id);
    const lead = has
      ? [iconButton({ icon: h('span', { class: 'k-tree-arrow' }, '▸'), label: 'Раскрыть или свернуть', size: 'S', cls: 'k-tree-chev', onClick: flip }), ' ', typeof n.label === 'string' ? link({ label: n.label, onClick: flip }) : n.label]
      : [h('span', { class: 'k-tree-gap' }), ' ', n.label];
    rec.tr = h('tr', { class: ['k-lv' + rec.depth, n.cls || '', open.has(n.id) ? 'is-open' : ''].filter(Boolean).join(' '), 'data-id': n.id },
      h('td', { class: 'sticky' }, ...lead),
      ...periods.map((_, i) => cellTd(n.cells?.[i], i)),
      cellTd(n.total, -1, 'tot'),
      h('td', { class: 'tot k-tree-share' }, n.share ? [h('span', { class: 'num' }, n.share.text), shareBar(n.share.ratio)] : null));
    if (has) rec.tr.querySelector('.k-tree-chev').setAttribute('aria-expanded', String(open.has(n.id)));
    recs.set(n.id, rec);
    return rec;
  };

  const shareBar = (ratio) => {
    const i = h('i');
    i.style.setProperty('--w', Math.max(2, Math.min(100, (Number(ratio) || 0) * 100)) + '%');
    return h('div', { class: 'share-bar' }, i);
  };

  const body = h('tbody');
  const emit = (list, parent) => {
    const over = list.length > maxKids;
    list.forEach((n, i) => {
      if (over && i === keepKids) {
        const rest = list.slice(keepKids);
        const m = { moreOpen: false };
        const tr = h('tr', { class: 'k-tree-more k-lv' + (parent.depth + 1) }, h('td', { class: 'sticky' }, link({ label: moreLabel ? moreLabel(rest) : `Ещё ${rest.length}`, onClick: () => { parent.moreOpen = true; sync(true); } })), h('td', { colspan: String(colSpan - 1) }));
        m.tr = tr;
        parent.more = m;
        body.append(tr);
      }
      const rec = mkRec(n, parent, over && i >= keepKids);
      parent.kids.push(rec);
      body.append(rec.tr);
      if (n.kids?.length) emit(n.kids, rec);
    });
  };
  emit(rows, root);

  const setVis = (tr, v, animate) => {
    const was = !tr.classList.contains('k-tree-off');
    tr.classList.toggle('k-tree-off', !v);
    if (v && !was && animate) { tr.classList.add('k-tree-in'); setTimeout(() => tr.classList.remove('k-tree-in'), 260); }
  };
  const walk = (parent, show, animate) => {
    parent.kids.forEach((rec) => {
      const v = show && (!rec.isRest || parent.moreOpen);
      setVis(rec.tr, v, animate);
      rec.tr.classList.toggle('is-open', open.has(rec.id));
      rec.tr.querySelector('.k-tree-chev')?.setAttribute('aria-expanded', String(open.has(rec.id)));
      walk(rec, v && open.has(rec.id), animate);
    });
    if (parent.more) setVis(parent.more.tr, show && !parent.moreOpen, animate);
  };
  function sync(animate) {
    walk(root, true, animate);
    if (ins) { if (ins.rec.tr.classList.contains('k-tree-off')) closeInsert(); else setVis(ins.tr, true, false); }
  }
  function toggle(id, force) {
    const on = force ?? !open.has(id);
    if (on) open.add(id); else open.delete(id);
    sync(true);
  }
  const eachWithKids = (list, f) => list.forEach((r) => { if (r.kids?.length) { f(r.id); eachWithKids(r.kids, f); } });
  const expandAll = () => { eachWithKids(rows, (id) => open.add(id)); sync(true); };
  const collapseAll = () => { open.clear(); sync(true); };

  const fit = () => { if (ins) ins.content.style.setProperty('--w', wrap.clientWidth + 'px'); };
  const unlisten = () => { document.removeEventListener('keydown', onKey); window.removeEventListener('resize', fit); };
  const onKey = (e) => {
    if (!wrap.isConnected) { unlisten(); return; }
    if (e.key === 'Escape' && ins) closeInsert(true);
  };
  /** restore — вернуть фокус на ячейку, открывшую вставку (Esc, «Скрыть»); при переходе на другую вставку не нужен. */
  function closeInsert(restore) {
    if (!ins) return;
    const { rec, tr, onClose, opener } = ins;
    ins = null;
    rec.tr.classList.remove('is-sel');
    tr.remove();
    unlisten();
    if (restore === true && opener?.isConnected) opener.focus();
    onClose?.();
  }
  function insert(id, { title, onClose } = {}) {
    if (ins) closeInsert(false);
    const opener = wrap.contains(document.activeElement) ? document.activeElement : null;
    const rec = recs.get(id);
    const content = h('div', { class: 'k-tree-ins-body' });
    const box = h('div');
    const tr = h('tr', { class: 'k-tree-ins' }, h('td', { colspan: String(colSpan) }, content));
    content.append(h('div', { class: 'q-head' }, h('h3', null, title || ''), button({ label: 'Скрыть', kind: 'ghost', size: 'S', onClick: () => closeInsert(true) })), box);
    rec.tr.after(tr);
    rec.tr.classList.add('is-sel');
    ins = { rec, tr, onClose, opener, content };
    fit();
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', fit);
    tr.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    return { body: box, close: () => closeInsert(true) };
  }

  const table = h('table', { class: 'cal k-tree', 'aria-label': label || null },
    h('thead', null, h('tr', null,
      h('th', { class: 'sticky' }, head),
      ...periods.map((p) => h('th', { class: 'day' + (p.today ? ' today' : '') }, p.label)),
      h('th', { class: 'tot' }, totalLabel),
      h('th', { class: 'tot' }, shareLabel))),
    body);
  const wrap = mark(h('div', { class: 'panel cal-wrap k-tree-wrap' }, table), 'treeTable');
  sync(false);
  return { el: wrap, toggle, expandAll, collapseAll, insert, closeInsert };
}
