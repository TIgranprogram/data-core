import { api, PREFIX, session } from '../core/api.js';
import { h } from '../core/dom.js';
import { money, qty } from '../core/format.js';
import { onChange, patch } from '../core/router.js';
import { failBlock } from './busy.js';
import { paintOrder } from '../core/order-color.js';
import { toastError } from './toast.js';

/**
 * Доска — колонки слева направо (по статусу). Один компонент на все разделы с доской.
 * board = {
 *   columns: [{ key, label, tone, query: { status: '…' } }],
 *   card(row) → { title, meta: [узлы/строки], side },
 *   move?(row, toKey) → Promise<boolean>   // перенос карточки в другую колонку (только для admin/manager)
 *   perColumn: 30,
 *   columns[]: { compact — тонкие карточки, per — порция, portion — «ещё N →» дописывает порцию на месте }
 *   card(row, column) → ещё { body — свои узлы карточки вместо заголовка/мета, cls }; add(ключ колонки) + addLabel — «+ Добавить» в колонке;
 *   columns[].emptyText — строка или функция: что написать в пустой колонке (по умолчанию «Пусто»)
 *   headCount — сумма по колонкам уходит в onTotal (счётчик в шапке)
 *   columns[].hint — строка «что здесь делать» под названием; columns[].money — сумма колонки (resp.sum) для денежных ролей;
 *   columns[].multi = { label, run(rows) → число переведённых } — чекбоксы на карточках и полоса «Выбрано N · label»;
 *   card(row, c, { changed }) → ещё { foot — узел внизу карточки (чек-лист и кнопка; клики не открывают карточку) }
 * }
 * Перетаскивание — своё, на pointer-событиях (CANON §2, замечание пользователя 2026-10-19): карточка «поднимается»
 * и едет за курсором с тенью, на её месте пунктир, колонка-цель подсвечена; никакого полупрозрачного призрака
 * браузера и значка «нельзя». Мышь — сразу после сдвига на 6px; палец — долгое нажатие (350 мс), иначе это прокрутка.
 */
export function mountBoard(board, path, initialQuery, { onOpen, onChanged, onTotal }) {
  let query = initialQuery;
  const el = h('div', { class: 'board' + (board.cls ? ' ' + board.cls : '') });
  const per = board.perColumn || 30;
  const canMove = !!board.move && session.canEdit;

  const cols = board.columns.map((c) => {
    const n = h('span', { class: 'n' }, '…');
    const sum = h('span', { class: 'col-sum num', hidden: true });
    const body = h('div', { class: 'col-body' }, h('div', { class: 'skel', style: { margin: '8px 4px' } }));
    const all = c.multi && canMove ? h('button', { type: 'button', class: 'col-all link-btn', title: 'Отметить все карточки колонки', onclick: () => pickAll(me) }, 'Выбрать все') : null;
    const col = h('section', { class: 'col tone-' + (c.tone || 'dim'), 'aria-label': c.label, dataset: { key: c.key } },
      h('div', { class: 'col-head' }, h('span', { class: 'dot' }), h('span', null, c.label), n, sum),
      all ? h('div', { class: 'col-tools' }, all) : null,
      c.hint ? h('div', { class: 'col-hint' }, c.hint) : null, body);
    el.append(col);
    const me = { c, n, sum, body, col, page: 1, shown: 0, more: null, addLink: null, rows: [], all };
    return me;
  });
  /** «Выбрать все» в шапке колонки: отметить (или снять, если все уже отмечены) показанные карточки. */
  function pickAll(col) {
    const every = col.rows.length && col.rows.every((r) => sel.has(r.id));
    col.rows.forEach((r) => { if (every) sel.delete(r.id); else sel.set(r.id, r); });
    col.body.querySelectorAll('.tcard').forEach((x, i) => { const on = !every; x.classList.toggle('selected', on); const cb = x.querySelector('.t-pick input'); if (cb) cb.checked = on; });
    col.all.textContent = every ? 'Выбрать все' : 'Снять все';
    paintBar();
  }

  // ---------- Выбор нескольких карточек (columns[].multi) ----------
  const sel = new Map();
  let bar = null;
  const dropBar = () => { bar?.remove(); bar = null; document.body.classList.remove('has-board-bar'); };
  const unsub = onChange(() => setTimeout(() => { if (!el.isConnected) { dropBar(); unsub(); } }, 60));
  function paintBar() {
    const mc = cols.find((x) => x.c.multi)?.c.multi;
    if (!mc || !sel.size) { dropBar(); return; }
    if (!bar) { bar = h('div', { class: 'board-bar', role: 'toolbar', 'aria-label': 'Выбранные заявки' }); document.body.append(bar); document.body.classList.add('has-board-bar'); }
    const go = h('button', { class: 'btn btn-primary', type: 'button', onclick: async () => {
      go.disabled = true; go.classList.add('is-busy');
      try { const n = await mc.run([...sel.values()]); sel.clear(); dropBar(); if (n) onChanged(); else load(); }
      catch (ex) { toastError(ex); go.disabled = false; go.classList.remove('is-busy'); }
    } }, mc.label);
    bar.replaceChildren(h('b', null, `Выбрано ${sel.size}`), go, h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => { sel.clear(); dropBar(); cols.forEach(({ body, all }) => { if (all) all.textContent = 'Выбрать все'; }); cols.forEach(({ body }) => body.querySelectorAll('.tcard.selected').forEach((x) => { x.classList.remove('selected'); const i = x.querySelector('.t-pick input'); if (i) i.checked = false; })); } }, 'Снять'));
  }

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
  const fetchCol = async (c, page, my) => {
    const q = { query: { ...query, ...c.query, page, limit: c.per || per } };
    // 6 колонок = 6 запросов: быстрое «ввёл-стёр» упирается в лимит 10/с → один повтор через секунду
    const run = () => api(path, q).then((r) => (board.map && r?.items ? { ...r, items: r.items.map(board.map) } : r));
    return run().catch(async (e) => { if (e.status !== 429 || my !== seq) throw e; await new Promise((ok) => setTimeout(ok, 1100)); return run(); });
  };
  function cardEl(row, c) {
    const v = board.card(row, c, { changed: onChanged });
    const multi = !!c.multi && canMove;
    const card = h('article', { class: 'tcard' + (canMove ? ' movable' : '') + (c.compact ? ' compact' : '') + (v.cls ? ' ' + v.cls : ''), tabindex: '0', role: 'button',
      onclick: () => { if (!suppressClick) onOpen(row); }, onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(row); } } },
    multi ? pickEl(row) : null,
    ...(v.body ? [].concat(v.body) : [
      v.pic ? h('img', { class: 't-pic', src: PREFIX + (v.pic.thumb || v.pic.url), alt: '', loading: 'lazy', decoding: 'async', draggable: 'false', onerror: (e) => e.target.remove() }) : null,
      h('div', { class: 't-title', title: v.title }, v.title),
      h('div', { class: 't-meta' }, v.meta, v.side ? h('span', { class: 'num' }, v.side) : null)]),
    v.foot ? quiet(v.foot) : null);
    if (multi && sel.has(row.id)) card.classList.add('selected');
    bindDrag(card, row, c.key);
    return card;
  }
  /**
   * board.group(row) → { key, label, sub? } | null — карточки одной группы рядом под заголовком, свой цвет (как заказы на доске
   * «Проектирование», core/order-color.js). Порядок групп — по первой карточке; без группы — внизу, без заголовка.
   */
  function groupEls(rows, c) {
    const by = new Map();
    for (const row of rows) { const g = board.group(row); const k = g?.key || ''; if (!by.has(k)) by.set(k, { g, rows: [] }); by.get(k).rows.push(row); }
    const list = [...by.entries()].sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : 0));
    return list.map(([k, { g, rows: rs }]) => {
      const cards = rs.map((row) => { const el = cardEl(row, c); if (k) { paintOrder(el, k); el.classList.add('t-grouped'); } return el; });
      if (!k) return h('div', { class: 'db-group' }, ...cards);
      return paintOrder(h('div', { class: 'db-group' }, h('div', { class: 'db-ghead' }, h('i', { class: 'db-dot' }), h('b', null, g.label), g.sub ? h('span', { class: 'muted' }, ' · ' + g.sub) : null, rs.length > 1 ? h('span', { class: 'muted' }, ' · ' + rs.length) : null), ...cards), k);
    });
  }
  /** Блок внутри карточки со своими кнопками: нажатие не открывает карточку и не начинает перетаскивание. */
  function quiet(node) {
    for (const t of ['pointerdown', 'click', 'keydown']) node.addEventListener(t, (e) => e.stopPropagation());
    return node;
  }
  function pickEl(row) {
    const cb = h('input', { type: 'checkbox', 'aria-label': 'Выбрать заявку', checked: sel.has(row.id) });
    cb.addEventListener('change', () => { if (cb.checked) sel.set(row.id, row); else sel.delete(row.id); cb.closest('.tcard')?.classList.toggle('selected', cb.checked); paintBar(); });
    return quiet(h('label', { class: 't-pick', title: 'Выбрать' }, cb));
  }
  /** Карточки колонки; append — порция «ещё N →» дописывается в конец (c.portion), иначе колонка перерисовывается. */
  function paint(col, r, append, my) {
    const { c, body } = col;
    col.more?.remove(); col.addLink?.remove();
    col.shown = (append ? col.shown : 0) + r.items.length;
    col.rows = append ? [...col.rows, ...r.items] : [...r.items];
    if (col.all) col.all.textContent = 'Выбрать все';
    if (board.group && col.rows.length) body.replaceChildren(...groupEls(col.rows, c)); // группы (счёт) — колонка целиком, порция встаёт в свою группу
    else {
      const cards = r.items.map((row) => cardEl(row, c));
      if (!append) body.replaceChildren(...(cards.length ? cards : [h('div', { class: 'col-more muted' }, typeof c.emptyText === 'function' ? c.emptyText() : c.emptyText || 'Пусто')]));
      else body.append(...cards);
    }
    const rest = r.total - col.shown;
    col.more = null;
    if (rest > 0) {
      // c.portion — «ещё N →» дописывает порцию на месте; иначе остальное — списком (завершённое там свёрнуто по месяцам, фаза М)
      col.more = c.portion
        ? h('button', { type: 'button', class: 'col-more link-btn', onclick: async (e) => {
          const btn = e.currentTarget; btn.disabled = true;
          try { const next = await fetchCol(c, ++col.page, my); paint(col, next, true, my); } catch (ex) { col.page--; btn.disabled = false; toastError(ex); }
        } }, `ещё ${qty(Math.min(rest, c.per || per))} из ${qty(rest)} →`)
        : h('button', { type: 'button', class: 'col-more link-btn', onclick: () => patch({ view: undefined, page: undefined, ...(c.query.status ? { status: c.query.status } : {}) }) }, `ещё ${qty(rest)} — списком по месяцам →`);
      body.append(col.more);
    }
    // тихая ссылка «+ Добавить задачу» внизу колонки (board.add(ключ колонки))
    col.addLink = board.add && session.canEdit ? h('button', { type: 'button', class: 'col-add link-btn', onclick: () => board.add(c.key) }, board.addLabel || '+ Добавить') : null;
    if (col.addLink) body.append(col.addLink);
  }
  let loadedAt = 0;
  /** Точечное обновление после записи одной записи: только колонка, где карточка была, и колонка, куда она попала (board.colOf(row)). Иначе — всё. */
  function reloadFor(row) {
    if (Date.now() - loadedAt < 1000) return Promise.resolve(); // доска только что перезагружена (перенос карточки)
    const to = row && board.colOf ? board.colOf(row) : null;
    const from = row ? cols.find((x) => x.rows.some((q) => q.id === row.id)) : null;
    if (!from) return load(); // записи нет на экране — не угадываем, обновляем всё
    const list = cols.filter((x) => x === from || x.c.key === to);
    return load(list);
  }
  async function load(only) {
    const my = ++seq;
    loadedAt = Date.now();
    if (!only) { sel.clear(); dropBar(); }
    el.classList.add('loading');
    const totals = [];
    await Promise.all((only || cols).map(async (col) => {
      const { c, n, body } = col;
      try {
        col.page = 1;
        const r = await fetchCol(c, 1, my);
        if (my !== seq) return;
        n.textContent = qty(r.total); totals.push(r.total);
        if (c.money && session.canMoney && r.sum != null) { col.sum.textContent = money(r.sum); col.sum.hidden = false; } else col.sum.hidden = true;
        paint(col, r, false, my);
      } catch (e) {
        if (my !== seq) return;
        n.textContent = '—';
        body.replaceChildren(failBlock(e, null, { cls: 'col-more' }));
      }
    }));
    if (my === seq) { el.classList.remove('loading'); if (!only && board.headCount && totals.length === cols.length) onTotal?.(totals.reduce((a, b) => a + b, 0)); }
  }
  load();
  return { el, reload: () => load(), reloadFor, setQuery: (q) => { query = q; load(); } };
}
