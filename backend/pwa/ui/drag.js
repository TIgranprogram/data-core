/**
 * Перетаскивание карточки для новой доски «Проектирование» (DESIGN §4 «Доска заказов»). `ui/board.js` его не использует.
 * Карточка «поднимается» и едет за курсором тенью, цель подсвечена (`.drop`). Мышь — после сдвига на 6 px;
 * палец — долгое нажатие 350 мс (раньше сдвинулся — это прокрутка). Esc — отмена. На телефоне и с клавиатуры
 * основной путь — меню «Статус», перетаскивание только дополнение.
 *
 * draggable(el, { canStart(), onDrop(target, el), targetSel, scroller?, sourceClass? }) → снять обработчики().
 *  targetSel — селектор цели (`.col`), onDrop вызывается только если отпустили над целью.
 *  sourceClass — что повесить на исходную карточку, пока тащат (по умолчанию `placeholder` — пунктир; для позиций слева `is-lifted` — приглушена).
 * Общие классы `drag-ghost`, `placeholder`, `drop`, `body.dragging` — те же, что у ui/board.js.
 */
export const MOUSE_PX = 6, TOUCH_PX = 8, HOLD_MS = 350;

/** Что делать на движении: мышь — старт после 6 px, палец до долгого нажатия сдвинулся больше 8 px — это прокрутка. */
export function dragStep({ touch, started, dist }) {
  if (started) return 'move';
  if (touch) return dist > TOUCH_PX ? 'cancel' : 'wait';
  return dist >= MOUSE_PX ? 'start' : 'wait';
}

let active = null;
let lastEnd = 0;
const queue = [];

/** Идёт перетаскивание — перерисовку по `data-changed` откладываем (иначе карточка уедет из-под курсора). */
export const isDragging = () => !!active?.started;
/** Только что отпустили — клик по карточке не открывает панель. */
export const justDragged = () => Date.now() - lastEnd < 60;
/** Выполнить fn сразу, а во время перетаскивания — после него. */
export function afterDrag(fn) { if (isDragging()) queue.push(fn); else fn(); }

export function draggable(el, { canStart = () => true, onDrop, targetSel, scroller, sourceClass = 'placeholder' }) {
  const clickGuard = (e) => { if (justDragged()) { e.stopImmediatePropagation(); e.preventDefault(); } };
  el.addEventListener('click', clickGuard, true);

  const moveGhost = (d, x, y) => {
    d.ghost.style.transform = `translate(${x - d.dx - d.left}px, ${y - d.dy - d.top}px) rotate(2deg)`;
    const t = document.elementFromPoint(x, y)?.closest?.(targetSel) || null;
    if (d.over !== t) { d.over?.classList.remove('drop'); t?.classList.add('drop'); d.over = t; }
    if (scroller) {
      const b = scroller.getBoundingClientRect();
      if (x > b.right - 60) scroller.scrollLeft += 18; else if (x < b.left + 60) scroller.scrollLeft -= 18;
      if (y > b.bottom - 50) scroller.scrollTop += 14; else if (y < b.top + 50) scroller.scrollTop -= 14;
    }
  };
  const start = (d, e) => {
    const r = el.getBoundingClientRect();
    d.dx = d.x0 - r.left; d.dy = d.y0 - r.top; d.left = r.left; d.top = r.top;
    d.ghost = el.cloneNode(true);
    d.ghost.classList.add('drag-ghost');
    Object.assign(d.ghost.style, { width: r.width + 'px', left: r.left + 'px', top: r.top + 'px' });
    document.body.append(d.ghost);
    el.classList.add(sourceClass);
    document.body.classList.add('dragging');
    d.started = true;
    if (navigator.vibrate && d.touch) navigator.vibrate(15);
    moveGhost(d, e.clientX, e.clientY);
  };
  const finish = (commit) => {
    const d = active; active = null;
    if (!d) return;
    clearTimeout(d.timer);
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    document.removeEventListener('pointercancel', onCancel);
    document.removeEventListener('keydown', onEsc, true);
    if (!d.started) return;
    lastEnd = Date.now();
    document.body.classList.remove('dragging');
    d.over?.classList.remove('drop');
    const target = commit ? d.over : null;
    if (target) {
      d.ghost.remove();
      el.classList.remove(sourceClass);
      try { onDrop(target, el); } finally { queue.splice(0).forEach((fn) => fn()); }
    } else {
      const r = el.getBoundingClientRect();
      d.ghost.style.transition = 'transform .16s ease';
      d.ghost.style.transform = `translate(${r.left - d.left}px, ${r.top - d.top}px)`;
      setTimeout(() => { d.ghost.remove(); el.classList.remove(sourceClass); queue.splice(0).forEach((fn) => fn()); }, 160);
    }
  };
  function onMove(e) {
    const d = active;
    if (!d || e.pointerId !== d.pointerId) return;
    const dist = Math.hypot(e.clientX - d.x0, e.clientY - d.y0);
    const step = dragStep({ touch: d.touch, started: d.started, dist });
    if (step === 'cancel') { finish(false); return; }
    if (step === 'wait') return;
    if (step === 'start') start(d, e);
    e.preventDefault();
    moveGhost(d, e.clientX, e.clientY);
  }
  const onUp = (e) => { if (active && e.pointerId === active.pointerId) finish(true); };
  const onCancel = () => finish(false);
  const onEsc = (e) => { if (e.key === 'Escape' && active?.started) { e.stopPropagation(); finish(false); } };

  const down = (e) => {
    e.stopPropagation(); // вложенные перетаскиваемые (позиция внутри карточки заказа) не мешают друг другу
    if (active || !canStart() || (e.pointerType === 'mouse' && e.button !== 0)) return;
    if (e.target.closest?.('button, a, input, select, textarea, summary')) return; // кнопки карточки — не начало переноса
    const d = { over: null, started: false, x0: e.clientX, y0: e.clientY, pointerId: e.pointerId, touch: e.pointerType !== 'mouse', ghost: null };
    active = d;
    if (d.touch) d.timer = setTimeout(() => { if (active === d && !d.started) start(d, { clientX: d.x0, clientY: d.y0 }); }, HOLD_MS);
    document.addEventListener('pointermove', onMove, { passive: false });
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onCancel);
    document.addEventListener('keydown', onEsc, true);
  };
  const touchMove = (e) => { if (active?.started) e.preventDefault(); };
  const ctx = (e) => { if (active) e.preventDefault(); };
  el.addEventListener('pointerdown', down);
  el.addEventListener('touchmove', touchMove, { passive: false });
  el.addEventListener('contextmenu', ctx);
  return () => {
    el.removeEventListener('click', clickGuard, true);
    el.removeEventListener('pointerdown', down);
    el.removeEventListener('touchmove', touchMove);
    el.removeEventListener('contextmenu', ctx);
  };
}
