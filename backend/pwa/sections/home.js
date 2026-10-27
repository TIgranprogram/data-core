import { api, session } from '../core/api.js';
import { h } from '../core/dom.js';
import { failBlock } from '../ui/busy.js';
import { icon } from '../ui/icons.js';
import { modal } from '../ui/dialog.js';
import { isoDay, qty } from '../core/format.js';
import { patch, go } from '../core/router.js';
import { toast, toastError } from '../ui/toast.js';
import { SUPPLY_STATUS } from '../ui/badges.js';
import { receiveDialog } from './requests.js';
import { STAGE } from './salesorders.js';

/**
 * «Сегодня» — утренний бриф (docs/roles/tz/TODAY.md, этап 1): шапка с пульсом дня и колокольчиком,
 * лента дел с действием в один клик, неделя полосой, диаграммы SVG, быстрые действия.
 * Данные — один запрос GET /today?days=7. deps: { open(of, id), refreshCounts() }.
 */
const SNOOZE_KEY = 'dc-today-snooze';
const SEC_OF = { delivery: 'requests', shipment: 'salesorders', design: 'design' };
const KIND_LABEL = { delivery: 'Поставка', shipment: 'Отгрузка', design: 'Проектирование', question: 'Вопрос', payment: 'Платёж' };
const SVGNS = 'http://www.w3.org/2000/svg';

function svg(tag, attrs = {}, ...kids) {
  const n = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) n.setAttribute(k, v);
  for (const k of kids.flat()) if (k) n.append(k);
  return n;
}
const readSnooze = () => { try { return JSON.parse(localStorage.getItem(SNOOZE_KEY) || '{}') || {}; } catch { return {}; } };
const writeSnooze = (m) => { try { localStorage.setItem(SNOOZE_KEY, JSON.stringify(m)); } catch { /* приватный режим — не страшно */ } };
const plural = (n, a, b, c) => { const m = n % 100, d = n % 10; return m > 10 && m < 15 ? c : d === 1 ? a : d > 1 && d < 5 ? b : c; };
const tomorrow = () => { const d = new Date(); d.setDate(d.getDate() + 1); return d; };

export function mountHome(deps) {
  const now = new Date();
  const hour = now.getHours();
  const hello = hour < 5 ? 'Доброй ночи' : hour < 12 ? 'Доброе утро' : hour < 18 ? 'Добрый день' : 'Добрый вечер';
  const first = (session.name || '').split(' ')[0];
  const dayText = now.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
  const seeReq = session.sees('requests'), seeStock = session.sees('stock');

  let data = null, showAll = false, dayFilter = null, bellOpen = false;
  const pulseEl = h('p', { class: 'td-pulse' }, h('span', { class: 'skel', style: { width: '60%' } }));
  const bellBtn = h('button', { type: 'button', class: 'td-bell', title: 'Вопросы вам', 'aria-label': 'Вопросы вам', onclick: () => { bellOpen = !bellOpen; paintBell(); } });
  const bellPop = h('div', { class: 'td-bellpop', hidden: true });
  const feedEl = h('div', { class: 'td-feed' }, h('div', { class: 'td-card skel-card' }, h('span', { class: 'skel', style: { width: '70%' } })));
  const weekEl = h('div', { class: 'td-week' });
  const chartsEl = h('div', { class: 'td-charts' });

  // ---------- Действия ----------
  const openRec = (c) => {
    if (c.kind === 'payment') { go(session.sees('money') ? 'money' : 'orders'); return; }
    deps.open(SEC_OF[c.kind], c.id);
  };
  const dropCard = (c) => {
    if (!data) return;
    data.feed = data.feed.filter((x) => !(x.kind === c.kind && x.id === c.id));
    data.feedTotal = Math.max(0, (data.feedTotal || 0) - 1);
    paintFeed(); paintBell();
  };
  const done = (c) => { dropCard(c); deps.refreshCounts?.(); load(true); };

  async function answer(c) {
    let taskId = c.taskId || null;
    if (!taskId) try {
      const r = await api('/design-notes/open-questions');
      const q = (r.items || []).find((x) => String(x.id || x._id) === String(c.id));
      taskId = q && (q.taskId || q.task?.id);
    } catch { /* откроем раздел целиком */ }
    bellOpen = false; paintBell();
    if (taskId) deps.open('design', taskId); else go('design');
  }
  async function moveDate(c) {
    const input = h('input', { type: 'date', value: c.due && c.due > isoDay() ? c.due : isoDay(tomorrow()) });
    const saved = await modal({
      title: 'Перенести дату поставки: ' + c.title,
      body: h('label', { class: 'field' }, h('span', null, 'Новая дата'), input),
      okText: 'Перенести',
      onOk: async () => {
        if (!input.value) throw new Error('Выберите дату');
        await api(`/supply/requests/${c.id}`, { method: 'PATCH', body: { neededBy: input.value } });
        return input.value;
      },
    });
    if (!saved) return false;
    toast('Дата поставки перенесена', { undo: async () => { await api(`/supply/requests/${c.id}`, { method: 'PATCH', body: { neededBy: c.due } }); load(true); } });
    return true;
  }
  async function shipped(c) {
    const was = await api(`/salesorders/${c.id}`);
    await api(`/salesorders/${c.id}`, { method: 'PATCH', body: { stage: 'shipped', shipDate: isoDay() } });
    toast(`${c.title} → ${STAGE.shipped.label}`, { undo: async () => {
      await api(`/salesorders/${c.id}`, { method: 'PATCH', body: { stage: was.stage, shipDate: was.shipDate ? String(was.shipDate).slice(0, 10) : null } });
      load(true);
    } });
    return true;
  }
  async function receive(c) {
    const r = await api(`/supply/requests/${c.id}`);
    return !!(await receiveDialog(r));
  }
  const RUN = { open: async (c) => { openRec(c); return false; }, receive, shipped, move: moveDate, answer: async (c) => { await answer(c); return false; } };

  function snooze(c) {
    const m = readSnooze();
    m[c.kind + ':' + c.id] = isoDay(tomorrow());
    writeSnooze(m);
    dropCard(c);
    toast('Карточка вернётся завтра', { undo: () => { const k = readSnooze(); delete k[c.kind + ':' + c.id]; writeSnooze(k); load(true); } });
  }

  // ---------- Лента ----------
  const dueText = (c) => {
    if (c.kind === 'question') return 'ждёт ответа';
    if (c.overdueDays > 0) return `просрочено ${c.overdueDays} ${plural(c.overdueDays, 'день', 'дня', 'дней')}`;
    if (c.daysLeft === 0 || (c.due && c.due === isoDay())) return 'сегодня';
    if (c.daysLeft > 0) return `осталось ${c.daysLeft} ${plural(c.daysLeft, 'день', 'дня', 'дней')}`;
    return '';
  };
  function cardEl(c) {
    const li = h('article', { class: 'td-card tone-' + (c.tone || 'info'), tabindex: '0' });
    const btns = (c.actions || []).slice(0, 2).map((a, i) => h('button', {
      type: 'button', class: 'btn td-btn' + (i === 0 ? ' btn-primary' : ''),
      onclick: async (e) => {
        e.stopPropagation();
        const b = e.currentTarget; b.disabled = true; b.classList.add('is-busy');
        try {
          const ok = await (RUN[a.id] || RUN.open)(c);
          if (ok) { li.classList.add('leaving'); setTimeout(() => done(c), 180); }
        } catch (ex) { toastError(ex); } finally { b.disabled = false; b.classList.remove('is-busy'); }
      },
    }, a.label));
    li.append(
      h('span', { class: 'td-dot', 'aria-hidden': 'true' }),
      h('div', { class: 'td-main' },
        h('div', { class: 'td-kind' }, KIND_LABEL[c.kind] || ''),
        h('div', { class: 'td-title', title: c.title }, c.title),
        c.sub ? h('div', { class: 'td-sub' }, c.sub) : null,
        h('div', { class: 'td-due' }, dueText(c))),
      h('div', { class: 'td-acts' }, btns, h('button', { type: 'button', class: 'btn td-btn td-later', title: 'Спрятать карточку до завтра', onclick: (e) => { e.stopPropagation(); snooze(c); } }, 'На завтра')));
    li.addEventListener('click', (e) => { if (!e.target.closest('button')) openRec(c); });
    li.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target === li) openRec(c); });
    // Свайп влево (телефон) — «на завтра»
    let x0 = null;
    li.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; }, { passive: true });
    li.addEventListener('touchend', (e) => { if (x0 != null && e.changedTouches[0].clientX - x0 < -90) snooze(c); x0 = null; }, { passive: true });
    return li;
  }
  const visibleFeed = () => {
    const m = readSnooze(), t = isoDay();
    return (data?.feed || []).filter((c) => !(m[c.kind + ':' + c.id] > t) && (!dayFilter || c.due === dayFilter));
  };
  function paintFeed() {
    if (!data) return;
    const all = visibleFeed();
    const rows = showAll ? all : all.slice(0, 7);
    const more = all.length - rows.length;
    feedEl.replaceChildren(
      dayFilter ? h('div', { class: 'td-filter' }, `Дела на ${new Date(dayFilter + 'T00:00').toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })}`,
        h('button', { type: 'button', class: 'btn btn-sm', onclick: () => { dayFilter = null; paintFeed(); paintWeek(); } }, 'Показать все')) : null,
      ...rows.map(cardEl),
      !rows.length ? h('div', { class: 'td-empty' }, h('b', null, dayFilter ? 'На этот день дел нет' : 'Сегодня всё спокойно'),
        h('span', null, 'Срочных дел нет. Можно ', h('a', { href: '#fill' }, 'заполнить недостающие данные'), '.')) : null,
      more > 0 ? h('button', { type: 'button', class: 'btn td-more', onclick: () => { showAll = true; paintFeed(); } }, `Ещё ${qty(more)} ${plural(more, 'дело', 'дела', 'дел')} →`)
        : showAll && all.length > 7 ? h('button', { type: 'button', class: 'btn td-more', onclick: () => { showAll = false; paintFeed(); } }, 'Свернуть') : null);
  }

  // ---------- Шапка: пульс и колокольчик ----------
  function paintPulse() {
    const p = data?.pulse || {};
    const bits = [];
    const add = (n, a, b, c) => { if (n > 0) bits.push(`${n} ${plural(n, a, b, c)}`); };
    add(p.overdue, 'срок горит', 'срока горят', 'сроков горят');
    add(p.deliveriesToday, 'поставка ждём сегодня', 'поставки ждём сегодня', 'поставок ждём сегодня');
    add(p.shipmentsSoon, 'отгрузка скоро', 'отгрузки скоро', 'отгрузок скоро');
    add(p.questions, 'вопрос вам', 'вопроса вам', 'вопросов вам');
    pulseEl.textContent = bits.length ? bits.join(' · ') : 'Срочных дел нет';
    pulseEl.classList.toggle('calm', !bits.length);
  }
  function paintBell() {
    const qs = (data?.feed || []).filter((c) => c.kind === 'question');
    const n = data?.pulse?.questions ?? qs.length;
    bellBtn.replaceChildren(icon('bell'), n ? h('span', { class: 'td-bell-n' }, String(n)) : null);
    bellPop.hidden = !bellOpen;
    bellPop.replaceChildren(...(qs.length ? qs.map((c) => h('div', { class: 'td-q' },
      h('div', { class: 'td-q-t' }, c.title), c.sub ? h('div', { class: 'td-sub' }, c.sub) : null,
      h('button', { type: 'button', class: 'btn btn-sm btn-primary', onclick: () => answer(c) }, 'Ответить')))
      : [h('div', { class: 'td-sub' }, 'Вопросов к вам нет')]));
  }

  // ---------- Неделя ----------
  function paintWeek() {
    const days = data?.week || [];
    if (!days.length) { weekEl.replaceChildren(); return; }
    const max = Math.max(1, ...days.map((d) => d.events.length));
    const today = isoDay();
    weekEl.replaceChildren(h('h2', { class: 'td-h' }, 'Неделя'), h('div', { class: 'td-days' }, ...days.map((d) => {
      const dt = new Date(d.date + 'T00:00');
      const heat = Math.round((d.events.length / max) * 70);
      return h('button', {
        type: 'button', class: 'td-day' + (d.date === today ? ' today' : '') + (dayFilter === d.date ? ' on' : ''), style: { '--heat': heat },
        'aria-pressed': String(dayFilter === d.date),
        onclick: () => { dayFilter = dayFilter === d.date ? null : d.date; showAll = false; paintFeed(); paintWeek(); },
      },
        h('span', { class: 'td-dn' }, dt.toLocaleDateString('ru-RU', { weekday: 'short' })),
        h('b', { class: 'td-dd' }, String(dt.getDate())),
        h('span', { class: 'td-ev' }, d.events.slice(0, 6).map((e) => h('i', { class: 'td-pt k-' + e.kind, title: `${KIND_LABEL[e.kind] || ''}: ${e.title}` })),
          d.events.length > 6 ? h('small', null, '+' + (d.events.length - 6)) : null));
    })));
  }

  // ---------- Диаграммы ----------
  const chartBox = (title, body, note) => h('section', { class: 'panel td-chart' }, h('h3', null, title), body, note ? h('div', { class: 'td-sub' }, note) : null);
  function funnel(counts) {
    const rows = ['requested', 'in_progress', 'ordered', 'received'].map((k) => ({ k, label: SUPPLY_STATUS[k].label, n: counts[k] || 0 }));
    const max = Math.max(1, ...rows.map((r) => r.n));
    const w = 300, rh = 30;
    const s = svg('svg', { viewBox: `0 0 ${w} ${rows.length * rh}`, class: 'td-svg', role: 'img', 'aria-label': 'Заявки по пути' },
      rows.map((r, i) => svg('g', { class: 'td-bar sec-supply-fill', tabindex: '0', 'data-k': r.k },
        svg('rect', { x: 0, y: i * rh + 3, width: w, height: rh - 6, class: 'td-track' }),
        svg('rect', { x: 0, y: i * rh + 3, width: Math.max(r.n ? 4 : 0, (r.n / max) * w), height: rh - 6, rx: 4, class: 'td-fill-supply' }),
        svg('text', { x: 8, y: i * rh + 20, class: 'td-lbl' }, `${r.label} · ${qty(r.n)}`))));
    s.addEventListener('click', (e) => { const g = e.target.closest('[data-k]'); if (g) go('requests', { status: g.dataset.k }); });
    return chartBox('Заявки по пути', s);
  }
  function bars(m) {
    const keys = ['new', 'production', 'ready', 'shipped'];
    const rows = keys.map((k) => ({ k, label: STAGE[k].label, n: m.byStage?.[k] || 0 }));
    const max = Math.max(1, ...rows.map((r) => r.n));
    const w = 300, bw = 56, H = 110;
    const s = svg('svg', { viewBox: `0 0 ${w} ${H + 34}`, class: 'td-svg', role: 'img', 'aria-label': 'Заказы в работе' },
      rows.map((r, i) => {
        const x = 8 + i * 74, bh = Math.max(r.n ? 3 : 0, (r.n / max) * (H - 18));
        return svg('g', { 'data-k': r.k, class: 'td-bar' },
          svg('rect', { x, y: H - bh, width: bw, height: bh, rx: 4, class: 'td-fill-orders' }),
          svg('text', { x: x + bw / 2, y: H - bh - 4, 'text-anchor': 'middle', class: 'td-lbl' }, String(r.n)),
          svg('text', { x: x + bw / 2, y: H + 14, 'text-anchor': 'middle', class: 'td-cap' }, r.label.length > 10 ? r.label.slice(0, 9) + '…' : r.label));
      }));
    s.addEventListener('click', () => go('salesorders', { filter: 'active' }));
    return chartBox('Заказы в работе', s, m.overdue ? `Просрочено по сроку отгрузки: ${m.overdue}` : 'Просроченных нет');
  }
  function donut(title, parts, centerLabel, onPick) {
    const total = parts.reduce((a, p) => a + p.n, 0);
    const R = 42, C = 2 * Math.PI * R;
    let off = 0;
    const arcs = total ? parts.filter((p) => p.n > 0).map((p) => {
      const len = (p.n / total) * C;
      const el = svg('circle', { cx: 60, cy: 60, r: R, fill: 'none', 'stroke-width': 16, class: 'td-arc ' + p.cls, 'stroke-dasharray': `${len} ${C - len}`, 'stroke-dashoffset': -off, transform: 'rotate(-90 60 60)', 'data-k': p.k });
      off += len; return el;
    }) : [svg('circle', { cx: 60, cy: 60, r: R, fill: 'none', 'stroke-width': 16, class: 'td-track-c' })];
    const s = svg('svg', { viewBox: '0 0 120 120', class: 'td-svg td-ring', role: 'img', 'aria-label': title }, arcs,
      svg('text', { x: 60, y: 62, 'text-anchor': 'middle', class: 'td-big' }, String(total)),
      svg('text', { x: 60, y: 78, 'text-anchor': 'middle', class: 'td-cap' }, centerLabel));
    s.addEventListener('click', (e) => { const a = e.target.closest('[data-k]'); onPick(a?.dataset.k); });
    const legend = h('ul', { class: 'td-legend' }, parts.map((p) => h('li', null, h('i', { class: 'td-sw ' + p.cls }), `${p.label} · ${qty(p.n)}`)));
    return chartBox(title, h('div', { class: 'td-ringwrap' }, s, legend));
  }
  function moneyLine(days) {
    if (!days?.length) return null;
    const w = 300, H = 110, pad = 6;
    const vals = days.map((d) => d.balance), lo = Math.min(0, ...vals), hi = Math.max(0, ...vals), span = hi - lo || 1;
    const X = (i) => pad + (i / Math.max(1, days.length - 1)) * (w - pad * 2);
    const Y = (v) => pad + (1 - (v - lo) / span) * (H - pad * 2);
    const pts = days.map((d, i) => `${X(i)},${Y(d.balance)}`).join(' ');
    const s = svg('svg', { viewBox: `0 0 ${w} ${H}`, class: 'td-svg', role: 'img', 'aria-label': 'Остаток денег на 14 дней' },
      svg('line', { x1: pad, x2: w - pad, y1: Y(0), y2: Y(0), class: 'td-zero' }),
      svg('polyline', { points: pts, fill: 'none', class: 'td-line', 'stroke-width': 2 }),
      days.map((d, i) => (d.balance < 0 ? svg('circle', { cx: X(i), cy: Y(d.balance), r: 3.5, class: 'td-neg' }, svg('title', {}, `${d.date}: ${Math.round(d.balance).toLocaleString('ru-RU')} ₽`)) : null)));
    s.addEventListener('click', () => go('money'));
    const below = days.filter((d) => d.balance < 0).length;
    return chartBox('Деньги, 14 дней', s, below ? `Ниже нуля дней: ${below}` : 'Остаток не уходит ниже нуля');
  }
  function paintCharts() {
    const m = data?.metrics || {};
    const out = [];
    if (m.supply?.counts) out.push(funnel(m.supply.counts));
    if (m.orders) out.push(bars(m.orders));
    if (m.stock) out.push(donut('Склад', [
      { k: 'ok', label: 'В норме', n: m.stock.ok || 0, cls: 'c-ok' }, { k: 'low', label: 'Мало', n: m.stock.low || 0, cls: 'c-warn' }, { k: 'none', label: 'Нет', n: m.stock.none || 0, cls: 'c-danger' }],
    'позиций', (k) => go('stock', k && k !== 'ok' ? { status: k } : {})));
    if (m.design?.counts) { const c = m.design.counts; out.push(donut('Задачи проектирования', [
      { k: 'queue', label: 'В очереди', n: c.queue || 0, cls: 'c-info' }, { k: 'work', label: 'В работе', n: c.work || 0, cls: 'c-primary' },
      { k: 'paused', label: 'На паузе', n: c.paused || 0, cls: 'c-warn' }, { k: 'done', label: 'Готово', n: c.done || 0, cls: 'c-ok' }], 'задач', () => go('design'))); }
    const ml = m.money?.days && session.canMoney ? moneyLine(m.money.days) : null;
    if (ml) out.push(ml);
    chartsEl.replaceChildren(...out);
  }

  // ---------- Загрузка ----------
  async function load(silent = false) {
    try {
      data = await api('/today', { query: { days: 7 } });
      paintPulse(); paintBell(); paintFeed(); paintWeek(); paintCharts();
    } catch (e) {
      if (silent && data) return;
      const fb = failBlock(e, () => load());
      feedEl.replaceChildren(fb); pulseEl.textContent = '';
    }
  }

  // ---------- Быстрые действия ----------
  const act = (label, title, onclick) => h('button', { type: 'button', class: 'btn', title, onclick }, label);
  const actions = session.canEdit && (seeReq || seeStock) ? h('div', { class: 'today-actions' },
    seeReq ? [
      act('+ Заявка', 'Новая заявка — форма справа', () => patch({ of: 'requests', new: '1', open: undefined })),
      act('+ Из таблицы', 'Скопировать строки из Excel / сайта — заявки на все позиции', () => patch({ of: 'pasteorder', new: '1', open: undefined })),
      act('+ Счёт', 'Внести счёт, которого не было в заявках', () => patch({ of: 'invoice', new: '1', open: undefined }))] : null,
    seeStock ? [
      act('Принять машину', 'Приход по счёту', () => go('ops', { mode: 'in' })),
      act('− Списать', 'Выдача со склада', () => go('ops', {})),
      act('Бронь по списку', 'Спецификация → бронь на складе', () => go('ops', { mode: 'reserve' }))] : null) : null;

  // Диск сервера и целостность данных — админу, только если есть что показать
  const diskNote = h('p', { class: 'hint disk-note', hidden: true });
  if (session.role === 'admin' || session.user?.isOwner) {
    api('/health/disk').then((d) => {
      if (d.level === 'ok') return;
      diskNote.hidden = false;
      diskNote.replaceChildren(h('b', null, `Диск сервера занят на ${String(d.usedPct).replace('.', ',')}%`),
        ` — свободно ${(Math.round((d.freeBytes / 1024 ** 3) * 10) / 10).toLocaleString('ru-RU')} ГБ${d.daysLeft != null ? `, хватит примерно на ${d.daysLeft} дн.` : ''}. `,
        h('a', { href: '../admin/' }, 'Подробнее — «Администрирование → Сервер»'));
    }).catch(() => {});
    api('/health/integrity').then((r) => {
      if (!r.issues?.length) return;
      diskNote.after(h('p', { class: 'hint disk-note' }, h('b', null, 'Проверка данных: '), r.issues.map((x) => `${x.title} — ${x.count}`).join('; '), '. Напишите разработчику — исправим по плану.'));
    }).catch(() => {});
  }

  const el = h('div', { class: 'today' },
    h('div', { class: 'page-head td-head' },
      h('div', null, h('h1', null, 'Сегодня'), h('div', { class: 'sub' }, `${hello}${first ? ', ' + first : ''} · ${dayText}`), pulseEl),
      h('div', { class: 'td-bellwrap' }, bellBtn, bellPop)),
    diskNote,
    // на телефоне — три задачи «на ходу» крупно
    session.canEdit && (seeReq || seeStock) ? h('div', { class: 'go-tiles' },
      seeReq ? h('button', { type: 'button', class: 'go-tile', onclick: () => patch({ of: 'requests', new: '1', open: undefined }) },
        h('b', null, '+ Заявка'), h('span', null, 'закончилось — что, сколько')) : null,
      seeStock ? [h('a', { class: 'go-tile', href: '#ops?mode=in' }, h('b', null, 'Принять машину'), h('span', null, 'открыть счёт и отметить, что пришло')),
        h('a', { class: 'go-tile', href: '#ops' }, h('b', null, 'Выдать со склада'), h('span', null, 'найти позицию, сколько и кому'))] : null) : null,
    actions,
    h('div', { class: 'td-grid' },
      h('div', { class: 'td-left' }, h('h2', { class: 'td-h' }, 'Что горит сегодня'), feedEl, weekEl),
      h('aside', { class: 'td-right' }, chartsEl)));

  document.addEventListener('click', (e) => { if (bellOpen && !e.target.closest('.td-bellwrap')) { bellOpen = false; paintBell(); } });
  load();
  return { el, reload: () => load(true), update: () => {} };
}
