import { api, PREFIX, session } from '../core/api.js';
import { h } from '../core/dom.js';
import { qty } from '../core/format.js';
import { patch } from '../core/router.js';
import { toastError } from './toast.js';

/**
 * Доска — колонки слева направо (по статусу). Один компонент на все разделы с доской.
 * board = {
 *   columns: [{ key, label, tone, query: { status: '…' } }],
 *   card(row) → { title, meta: [узлы/строки], side },
 *   move?(row, toKey) → Promise<boolean>   // перенос карточки в другую колонку (только для admin/manager)
 *   perColumn: 30,
 * }
 * Перетаскивание — своё, на pointer-событиях (CANON §2, замечание пользователя 2026-10-19): карточка «поднимается»
 * и едет за курсором с тенью, на её месте пунктир, колонка-цель подсвечена; никакого полупрозрачного призрака
 * браузера и значка «нельзя». Мышь — сразу после сдвига на 6px; палец — долгое нажатие (350 мс), иначе это прокрутка.
 */
export function mountBoard(board, path, initialQuery, { onOpen, onChanged }) {
  let query = initialQuery;
  const el = h('div', { class: 'board' });
  const per = board.perColumn || 30;
  const canMove = !!board.move && session.canEdit;

  const cols = board.columns.map((c) => {
    const n = h('span', { class: 'n' }, '…');
    const body = h('div', { class: 'col-body' }, h('div', { class: 'skel', style: { margin: '8px 4px' } }));
    const col = h('section', { class: 'col tone-' + (c.tone || 'dim'), 'aria-label': c.label, dataset: { key: c.key } },
      h('div', { class: 'col-head' }, h('span', { class: 'dot' }), h('span', null, c.label), n), body);
    el.append(col);
    return { c, n, body, col };
  });

  // ---------- Перетаскивание ----------
  let drag = null; // { row, from, card, ghost, dx, dy, over, started, timer, x0, y0, pointerId, touch }
  let suppressClick = false;

  function startDrag(e) {
    const r = drag.card.getBoundingClientRect();
    drag.dx = drag.x0 - r.left; drag.dy = drag.y0 - r.top;
    drag.ghost = drag.card.cloneNode(true);
    drag.ghost.classList.add('drag-ghost');
    Object.assign(drag.ghost.style, { width: r.width + 'px', left: r.left + 'px', top: r.top + 'px' });
    document.body.append(drag.ghost);
    drag.card.classList.add('placeholder');
    document.body.classList.add('dragging');
    drag.started = true;
    if (navigator.vibrate && drag.touch) navigator.vibrate(15);
    moveGhost(e.clientX, e.clientY);
  }
  function moveGhost(x, y) {
    drag.ghost.style.transform = `translate(${x - drag.dx - parseFloat(drag.ghost.style.left)}px, ${y - drag.dy - parseFloat(drag.ghost.style.top)}px) rotate(2deg)`;
    const target = document.elementFromPoint(x, y)?.closest?.('.col');
    const key = target && el.contains(target) ? target.dataset.key : null;
    if (drag.over !== key) {
      cols.forEach(({ c, col }) => col.classList.toggle('drop', c.key === key && key !== drag.from));
      drag.over = key;
    }
    // Автопрокрутка доски у краёв
    const b = el.getBoundingClientRect();
    if (x > b.right - 60) el.scrollLeft += 18; else if (x < b.left + 60) el.scrollLeft -= 18;
  }
  function endDrag(commit) {
    const d = drag; drag = null;
    if (!d) return;
    clearTimeout(d.timer);
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    document.removeEventListener('pointercancel', onCancel);
    document.removeEventListener('keydown', onEsc, true);
    if (!d.started) return;
    suppressClick = true; setTimeout(() => { suppressClick = false; }, 0);
    cols.forEach(({ col }) => col.classList.remove('drop'));
    document.body.classList.remove('dragging');
    const to = commit ? d.over : null;
    if (to && to !== d.from) {
      // Карточка «приземляется» в колонку сразу; если перенос не состоялся — список перечитается
      const target = cols.find((x) => x.c.key === to);
      d.ghost.remove();
      d.card.classList.remove('placeholder');
      target.body.prepend(d.card);
      d.card.classList.add('landed');
      Promise.resolve(board.move(d.row, to)).then((ok) => { if (ok) onChanged(); else load(); }).catch((ex) => { toastError(ex); load(); });
    } else {
      // Возврат на место — плавно
      const r = d.card.getBoundingClientRect();
      d.ghost.style.transition = 'transform .16s ease';
      d.ghost.style.transform = `translate(${r.left - parseFloat(d.ghost.style.left)}px, ${r.top - parseFloat(d.ghost.style.top)}px)`;
      setTimeout(() => { d.ghost.remove(); d.card.classList.remove('placeholder'); }, 160);
    }
  }
  function onMove(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    if (!drag.started) {
      const dist = Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0);
      if (drag.touch) { if (dist > 8) endDrag(false); return; } // палец сдвинулся до долгого нажатия — это прокрутка
      if (dist < 6) return;
      startDrag(e);
    }
    e.preventDefault();
    moveGhost(e.clientX, e.clientY);
  }
  const onUp = (e) => { if (drag && e.pointerId === drag.pointerId) endDrag(true); };
  const onCancel = () => endDrag(false);
  const onEsc = (e) => { if (e.key === 'Escape' && drag?.started) { e.stopPropagation(); endDrag(false); } };

  function bindDrag(card, row, from) {
    card.addEventListener('pointerdown', (e) => {
      if (!canMove || drag || (e.pointerType === 'mouse' && e.button !== 0)) return;
      drag = { row, from, card, over: null, started: false, x0: e.clientX, y0: e.clientY, pointerId: e.pointerId, touch: e.pointerType !== 'mouse' };
      if (drag.touch) drag.timer = setTimeout(() => { if (drag && !drag.started) startDrag({ clientX: drag.x0, clientY: drag.y0 }); }, 350);
      document.addEventListener('pointermove', onMove, { passive: false });
      document.addEventListener('pointerup', onUp);
      document.addEventListener('pointercancel', onCancel);
      document.addEventListener('keydown', onEsc, true);
    });
    // Пока палец держит карточку — страница не прокручивается
    card.addEventListener('touchmove', (e) => { if (drag?.started) e.preventDefault(); }, { passive: false });
    card.addEventListener('contextmenu', (e) => { if (drag) e.preventDefault(); });
  }

  // только последний ответ (ПО.2): быстрый поиск-стирание — старый медленный ответ не затирает новый
  let seq = 0;
  async function load() {
    const my = ++seq;
    el.classList.add('loading');
    await Promise.all(cols.map(async ({ c, n, body }) => {
      try {
        const q = { query: { ...query, ...c.query, page: 1, limit: per } };
        // 6 колонок = 6 запросов: быстрое «ввёл-стёр» упирается в лимит 10/с → один повтор через секунду
        const r = await api(path, q).catch(async (e) => { if (e.status !== 429 || my !== seq) throw e; await new Promise((ok) => setTimeout(ok, 1100)); return api(path, q); });
        if (my !== seq) return;
        n.textContent = qty(r.total);
        if (!r.items.length) { body.replaceChildren(h('div', { class: 'col-more muted' }, 'Пусто')); return; }
        body.replaceChildren(...r.items.map((row) => {
          const v = board.card(row);
          const card = h('article', { class: 'tcard' + (canMove ? ' movable' : ''), tabindex: '0',
            onclick: () => { if (!suppressClick) onOpen(row); }, onkeydown: (e) => { if (e.key === 'Enter') onOpen(row); } },
          v.pic ? h('img', { class: 't-pic', src: PREFIX + (v.pic.thumb || v.pic.url), alt: '', loading: 'lazy', draggable: 'false', onerror: (e) => e.target.remove() }) : null,
          h('div', { class: 't-title', title: v.title }, v.title),
          h('div', { class: 't-meta' }, v.meta, v.side ? h('span', { class: 'num' }, v.side) : null));
          bindDrag(card, row, c.key);
          return card;
        }));
        // Остальное — списком (завершённое там свёрнуто по месяцам, фаза М)
        if (r.total > r.items.length) body.append(h('button', { type: 'button', class: 'col-more link-btn', onclick: () => patch({ view: undefined, page: undefined, ...(c.query.status ? { status: c.query.status } : {}) }) }, `ещё ${qty(r.total - r.items.length)} — списком по месяцам →`));
      } catch (e) {
        if (my !== seq) return;
        n.textContent = '—';
        body.replaceChildren(h('div', { class: 'col-more' }, 'Не загрузилось: ' + e.message));
      }
    }));
    if (my === seq) el.classList.remove('loading');
  }
  load();
  return { el, reload: load, setQuery: (q) => { query = q; load(); } };
}
